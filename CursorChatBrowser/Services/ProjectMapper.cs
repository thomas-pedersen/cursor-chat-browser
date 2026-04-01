using System.Text.Json;
using CursorChatBrowser.Models;

namespace CursorChatBrowser.Services;

/// <summary>
/// Shared logic for mapping conversations to workspace projects.
/// Ported from the duplicated determineProjectForConversation / getProjectFromFilePath
/// functions in the TypeScript codebase.
/// </summary>
public static class ProjectMapper
{
    public static Dictionary<string, string> BuildProjectNameToWorkspaceIdMap(List<WorkspaceEntry> entries)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries)
        {
            if (string.IsNullOrEmpty(entry.Folder)) continue;
            var folder = entry.Folder.Replace("file://", "");
            var folderName = folder.Split('/', '\\').LastOrDefault(s => !string.IsNullOrEmpty(s));
            if (!string.IsNullOrEmpty(folderName))
                map.TryAdd(folderName, entry.Name);
        }
        return map;
    }

    public static string? DetermineProjectForConversation(
        JsonElement composerData,
        string composerId,
        Dictionary<string, List<string>> projectLayoutsMap,
        Dictionary<string, string> projectNameToWorkspaceId,
        List<WorkspaceEntry> workspaceEntries,
        Dictionary<string, JsonElement> bubbleMap)
    {
        if (projectLayoutsMap.TryGetValue(composerId, out var layouts))
        {
            foreach (var projectName in layouts)
            {
                if (projectNameToWorkspaceId.TryGetValue(projectName, out var wsId))
                    return wsId;
            }
        }

        if (composerData.TryGetProperty("newlyCreatedFiles", out var ncf) && ncf.ValueKind == JsonValueKind.Array)
        {
            foreach (var file in ncf.EnumerateArray())
            {
                if (file.TryGetProperty("uri", out var uri) && uri.TryGetProperty("path", out var p))
                {
                    var pid = GetProjectFromFilePath(p.GetString()!, workspaceEntries);
                    if (pid != null) return pid;
                }
            }
        }

        if (composerData.TryGetProperty("codeBlockData", out var cbd) && cbd.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in cbd.EnumerateObject())
            {
                var filePath = prop.Name.Replace("file://", "");
                var pid = GetProjectFromFilePath(filePath, workspaceEntries);
                if (pid != null) return pid;
            }
        }

        if (composerData.TryGetProperty("fullConversationHeadersOnly", out var headers) && headers.ValueKind == JsonValueKind.Array)
        {
            foreach (var header in headers.EnumerateArray())
            {
                if (!header.TryGetProperty("bubbleId", out var bid)) continue;
                var bubbleId = bid.GetString()!;
                if (!bubbleMap.TryGetValue(bubbleId, out var bubble)) continue;

                if (TryMatchFilesInBubble(bubble, "relevantFiles", workspaceEntries, out var pid1)) return pid1;
                if (TryMatchUrisInBubble(bubble, "attachedFileCodeChunksUris", workspaceEntries, out var pid2)) return pid2;
                if (TryMatchFileSelectionsInBubble(bubble, workspaceEntries, out var pid3)) return pid3;
            }
        }

        return null;
    }

    public static Dictionary<string, List<string>> BuildProjectLayoutsMap(List<(string Key, string Value)> messageContextRows)
    {
        var map = new Dictionary<string, List<string>>();
        foreach (var (key, value) in messageContextRows)
        {
            var parts = key.Split(':');
            if (parts.Length < 2) continue;
            var composerId = parts[1];
            try
            {
                using var doc = JsonDocument.Parse(value);
                var root = doc.RootElement;
                if (!root.TryGetProperty("projectLayouts", out var layouts) || layouts.ValueKind != JsonValueKind.Array)
                    continue;

                if (!map.ContainsKey(composerId))
                    map[composerId] = new List<string>();

                foreach (var layout in layouts.EnumerateArray())
                {
                    if (layout.ValueKind != JsonValueKind.String) continue;
                    try
                    {
                        using var ldoc = JsonDocument.Parse(layout.GetString()!);
                        if (ldoc.RootElement.TryGetProperty("rootPath", out var rp))
                            map[composerId].Add(rp.GetString()!);
                    }
                    catch { }
                }
            }
            catch { }
        }
        return map;
    }

    private static string? GetProjectFromFilePath(string filePath, List<WorkspaceEntry> entries)
    {
        var normalized = filePath.Replace("file://", "");
        foreach (var entry in entries)
        {
            if (string.IsNullOrEmpty(entry.Folder)) continue;
            var wsPath = entry.Folder.Replace("file://", "");
            if (normalized.StartsWith(wsPath, StringComparison.OrdinalIgnoreCase))
                return entry.Name;
        }
        return null;
    }

    private static bool TryMatchFilesInBubble(JsonElement bubble, string prop, List<WorkspaceEntry> entries, out string? projectId)
    {
        projectId = null;
        if (!bubble.TryGetProperty(prop, out var files) || files.ValueKind != JsonValueKind.Array) return false;
        foreach (var f in files.EnumerateArray())
        {
            if (f.ValueKind != JsonValueKind.String) continue;
            projectId = GetProjectFromFilePath(f.GetString()!, entries);
            if (projectId != null) return true;
        }
        return false;
    }

    private static bool TryMatchUrisInBubble(JsonElement bubble, string prop, List<WorkspaceEntry> entries, out string? projectId)
    {
        projectId = null;
        if (!bubble.TryGetProperty(prop, out var uris) || uris.ValueKind != JsonValueKind.Array) return false;
        foreach (var uri in uris.EnumerateArray())
        {
            if (uri.TryGetProperty("path", out var p))
            {
                projectId = GetProjectFromFilePath(p.GetString()!, entries);
                if (projectId != null) return true;
            }
        }
        return false;
    }

    private static bool TryMatchFileSelectionsInBubble(JsonElement bubble, List<WorkspaceEntry> entries, out string? projectId)
    {
        projectId = null;
        if (!bubble.TryGetProperty("context", out var ctx)) return false;
        if (!ctx.TryGetProperty("fileSelections", out var sels) || sels.ValueKind != JsonValueKind.Array) return false;
        foreach (var sel in sels.EnumerateArray())
        {
            if (sel.TryGetProperty("uri", out var uri) && uri.TryGetProperty("path", out var p))
            {
                projectId = GetProjectFromFilePath(p.GetString()!, entries);
                if (projectId != null) return true;
            }
        }
        return false;
    }
}
