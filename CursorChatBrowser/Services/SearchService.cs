using System.Text.Json;
using CursorChatBrowser.Models;

namespace CursorChatBrowser.Services;

public class SearchService(WorkspacePathResolver pathResolver)
{
    public async Task<List<SearchResult>> SearchAsync(string query, string type = "all")
    {
        var workspacePath = pathResolver.Resolve();
        var results = new List<SearchResult>();
        var queryLower = query.ToLowerInvariant();

        if (!Directory.Exists(workspacePath))
            return results;

        var dirs = Directory.GetDirectories(workspacePath);
        var workspaceEntries = new List<WorkspaceEntry>();
        foreach (var dir in dirs)
        {
            var name = Path.GetFileName(dir);
            var wsJson = Path.Combine(dir, "workspace.json");
            if (!File.Exists(wsJson)) continue;
            var folder = "";
            try
            {
                var json = await File.ReadAllTextAsync(wsJson);
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("folder", out var f))
                    folder = f.GetString() ?? "";
            }
            catch { }
            workspaceEntries.Add(new WorkspaceEntry(name, wsJson, folder));
        }

        var projectNameToWsId = ProjectMapper.BuildProjectNameToWorkspaceIdMap(workspaceEntries);

        var globalDbPath = Path.Combine(workspacePath, "..", "globalStorage", "state.vscdb");
        if (File.Exists(globalDbPath))
        {
            try
            {
                var bubbleRows = SqliteHelper.QueryKv(globalDbPath, "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'");
                var bubbleMap = new Dictionary<string, JsonElement>();
                foreach (var (key, value) in bubbleRows)
                {
                    var parts = key.Split(':');
                    if (parts.Length < 3) continue;
                    try { using var doc = JsonDocument.Parse(value); bubbleMap[parts[2]] = doc.RootElement.Clone(); }
                    catch { }
                }

                var msgCtxRows = SqliteHelper.QueryKv(globalDbPath, "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'");
                var projectLayoutsMap = ProjectMapper.BuildProjectLayoutsMap(msgCtxRows);

                if (type is "all" or "composer")
                {
                    var composerRows = SqliteHelper.QueryKv(globalDbPath,
                        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND LENGTH(value) > 10");

                    foreach (var (key, value) in composerRows)
                    {
                        var composerId = key.Split(':').ElementAtOrDefault(1) ?? "";
                        try
                        {
                            using var doc = JsonDocument.Parse(value);
                            var cd = doc.RootElement;
                            var projectId = ProjectMapper.DetermineProjectForConversation(
                                cd, composerId, projectLayoutsMap, projectNameToWsId, workspaceEntries, bubbleMap);

                            var wsEntry = workspaceEntries.FirstOrDefault(e => e.Name == projectId);
                            var title = cd.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
                                ? n.GetString()! : $"Conversation {composerId[..Math.Min(8, composerId.Length)]}";

                            string matchingText = "";
                            bool hasMatch = title.Contains(queryLower, StringComparison.OrdinalIgnoreCase);
                            if (hasMatch) matchingText = title;

                            if (!hasMatch && cd.TryGetProperty("fullConversationHeadersOnly", out var headers) && headers.ValueKind == JsonValueKind.Array)
                            {
                                foreach (var header in headers.EnumerateArray())
                                {
                                    if (!header.TryGetProperty("bubbleId", out var bid)) continue;
                                    if (!bubbleMap.TryGetValue(bid.GetString()!, out var bubble)) continue;
                                    var text = ConversationService.ExtractTextFromBubble(bubble);
                                    var idx = text.IndexOf(queryLower, StringComparison.OrdinalIgnoreCase);
                                    if (idx >= 0)
                                    {
                                        hasMatch = true;
                                        var start = Math.Max(0, idx - 50);
                                        var end = Math.Min(text.Length, idx + query.Length + 100);
                                        matchingText = (start > 0 ? "..." : "") + text[start..end] + (end < text.Length ? "..." : "");
                                        break;
                                    }
                                }
                            }

                            if (hasMatch && projectId != null)
                            {
                                var ts = cd.TryGetProperty("lastUpdatedAt", out var lu) ? lu.GetInt64()
                                    : cd.TryGetProperty("createdAt", out var ca) ? ca.GetInt64()
                                    : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                                results.Add(new SearchResult(projectId, wsEntry?.Folder, composerId, title, ts, matchingText, "composer"));
                            }
                        }
                        catch { }
                    }
                }

                if (type is "all" or "chat")
                {
                    var chatJson = SqliteHelper.QuerySingleValue(globalDbPath,
                        "SELECT value FROM ItemTable WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'");
                    if (chatJson != null)
                        SearchChatData(chatJson, queryLower, query, "global", null, results);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error searching global storage: {ex.Message}");
            }
        }

        foreach (var entry in workspaceEntries)
        {
            var dbPath = Path.Combine(workspacePath, entry.Name, "state.vscdb");
            if (!File.Exists(dbPath)) continue;

            try
            {
                if (type is "all" or "chat")
                {
                    var chatJson = SqliteHelper.QuerySingleValue(dbPath,
                        "SELECT value FROM ItemTable WHERE [key] = 'workbench.panel.aichat.view.aichat.chatdata'");
                    if (chatJson != null)
                        SearchChatData(chatJson, queryLower, query, entry.Name, entry.Folder, results);
                }

                if (type is "all" or "composer")
                {
                    var composerJson = SqliteHelper.QuerySingleValue(dbPath,
                        "SELECT value FROM ItemTable WHERE [key] = 'composer.composerData'");
                    if (composerJson != null)
                        SearchComposerData(composerJson, queryLower, query, entry.Name, entry.Folder, results);
                }
            }
            catch { }
        }

        var seen = new HashSet<string>();
        results.RemoveAll(r => !seen.Add(r.ChatId));
        results.Sort((a, b) => b.Timestamp.CompareTo(a.Timestamp));
        return results;
    }

    private static void SearchChatData(string json, string queryLower, string query, string wsId, string? folder, List<SearchResult> results)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("tabs", out var tabs) || tabs.ValueKind != JsonValueKind.Array) return;

            foreach (var tab in tabs.EnumerateArray())
            {
                var tabId = tab.TryGetProperty("tabId", out var tid) ? tid.GetString() ?? "" : "";
                var chatTitle = tab.TryGetProperty("chatTitle", out var ct) ? ct.GetString() ?? "" : $"Chat {tabId[..Math.Min(8, tabId.Length)]}";
                var matchingText = "";
                var hasMatch = chatTitle.Contains(queryLower, StringComparison.OrdinalIgnoreCase);
                if (hasMatch) matchingText = chatTitle;

                if (!hasMatch && tab.TryGetProperty("bubbles", out var bubbles) && bubbles.ValueKind == JsonValueKind.Array)
                {
                    foreach (var b in bubbles.EnumerateArray())
                    {
                        if (!b.TryGetProperty("text", out var t)) continue;
                        var text = t.GetString() ?? "";
                        var idx = text.IndexOf(queryLower, StringComparison.OrdinalIgnoreCase);
                        if (idx >= 0)
                        {
                            hasMatch = true;
                            var start = Math.Max(0, idx - 50);
                            var end = Math.Min(text.Length, idx + query.Length + 100);
                            matchingText = (start > 0 ? "..." : "") + text[start..end] + (end < text.Length ? "..." : "");
                            break;
                        }
                    }
                }

                if (hasMatch)
                {
                    var ts = tab.TryGetProperty("lastSendTime", out var lst) && lst.ValueKind == JsonValueKind.Number
                        ? lst.GetInt64() : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    results.Add(new SearchResult(wsId, folder, tabId, chatTitle, ts, matchingText, "chat"));
                }
            }
        }
        catch { }
    }

    private static void SearchComposerData(string json, string queryLower, string query, string wsId, string? folder, List<SearchResult> results)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("allComposers", out var composers) || composers.ValueKind != JsonValueKind.Array) return;

            foreach (var c in composers.EnumerateArray())
            {
                var cId = c.TryGetProperty("composerId", out var cid) ? cid.GetString() ?? "" : "";
                var cText = c.TryGetProperty("text", out var ct) ? ct.GetString() ?? "" : "";
                var matchingText = "";
                var hasMatch = cText.Contains(queryLower, StringComparison.OrdinalIgnoreCase);
                if (hasMatch) matchingText = cText;

                if (!hasMatch && c.TryGetProperty("conversation", out var conv) && conv.ValueKind == JsonValueKind.Array)
                {
                    foreach (var msg in conv.EnumerateArray())
                    {
                        if (!msg.TryGetProperty("text", out var t)) continue;
                        var text = t.GetString() ?? "";
                        var idx = text.IndexOf(queryLower, StringComparison.OrdinalIgnoreCase);
                        if (idx >= 0)
                        {
                            hasMatch = true;
                            var start = Math.Max(0, idx - 50);
                            var end = Math.Min(text.Length, idx + query.Length + 100);
                            matchingText = (start > 0 ? "..." : "") + text[start..end] + (end < text.Length ? "..." : "");
                            break;
                        }
                    }
                }

                if (hasMatch)
                {
                    var ts = c.TryGetProperty("lastUpdatedAt", out var lu) && lu.ValueKind == JsonValueKind.Number
                        ? lu.GetInt64()
                        : c.TryGetProperty("createdAt", out var ca) && ca.ValueKind == JsonValueKind.Number
                            ? ca.GetInt64() : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    var title = string.IsNullOrEmpty(cText) ? $"Composer {cId[..Math.Min(8, cId.Length)]}" : cText;
                    results.Add(new SearchResult(wsId, folder, cId, title, ts, matchingText, "composer"));
                }
            }
        }
        catch { }
    }
}
