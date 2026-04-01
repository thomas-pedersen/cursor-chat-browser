using System.Text.Json;
using CursorChatBrowser.Models;

namespace CursorChatBrowser.Services;

/// <summary>
/// Shared logic for mapping conversations to workspace projects.
/// </summary>
public static class ProjectMapper
{
    /// <summary>
    /// Normalizes a file URI or path to a consistent forward-slash format
    /// with percent-encoding resolved, suitable for prefix matching.
    /// </summary>
    internal static string NormalizePath(string path)
    {
        var result = path.Replace("file:///", "").Replace("file://", "");
        result = Uri.UnescapeDataString(result);
        if (result.Length > 2 && result[0] == '/' && result[2] == ':')
            result = result[1..];
        return result.Replace('\\', '/').TrimEnd('/');
    }

    public static Dictionary<string, string> BuildProjectNameToWorkspaceIdMap(List<WorkspaceEntry> entries)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries)
        {
            if (string.IsNullOrEmpty(entry.Folder)) continue;
            var folder = NormalizePath(entry.Folder);
            var folderName = folder.Split('/').LastOrDefault(s => !string.IsNullOrEmpty(s));
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
                var pid = MatchUriElement(file, workspaceEntries);
                if (pid != null) return pid;
            }
        }

        if (composerData.TryGetProperty("codeBlockData", out var cbd) && cbd.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in cbd.EnumerateObject())
            {
                var pid = GetProjectFromFilePath(prop.Name, workspaceEntries);
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

        // Newer Cursor versions store attached file/selection context at the
        // composerData level rather than per-bubble.
        if (composerData.TryGetProperty("context", out var ctx))
        {
            if (TryMatchUriArray(ctx, "fileSelections", workspaceEntries, out var pid4)) return pid4;
            if (TryMatchUriArray(ctx, "selections", workspaceEntries, out var pid5)) return pid5;
            if (TryMatchUriArray(ctx, "folderSelections", workspaceEntries, out var pid6)) return pid6;
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
        var normalized = NormalizePath(filePath);
        foreach (var entry in entries)
        {
            if (string.IsNullOrEmpty(entry.Folder)) continue;
            var wsPath = NormalizePath(entry.Folder);
            if (normalized.StartsWith(wsPath, StringComparison.OrdinalIgnoreCase))
                return entry.Name;
        }
        return null;
    }

    /// <summary>
    /// Tries to extract a file path from a JSON element that has a uri.path
    /// or uri.fsPath property and match it to a workspace.
    /// </summary>
    private static string? MatchUriElement(JsonElement element, List<WorkspaceEntry> entries)
    {
        if (element.TryGetProperty("uri", out var uri))
        {
            if (uri.TryGetProperty("path", out var p))
            {
                var pid = GetProjectFromFilePath(p.GetString()!, entries);
                if (pid != null) return pid;
            }
            if (uri.TryGetProperty("fsPath", out var fp))
            {
                var pid = GetProjectFromFilePath(fp.GetString()!, entries);
                if (pid != null) return pid;
            }
        }
        return null;
    }

    /// <summary>
    /// Matches an array of objects with uri.path or uri.fsPath to a workspace.
    /// Used for context.fileSelections, context.selections, context.folderSelections.
    /// </summary>
    private static bool TryMatchUriArray(JsonElement parent, string prop, List<WorkspaceEntry> entries, out string? projectId)
    {
        projectId = null;
        if (!parent.TryGetProperty(prop, out var arr) || arr.ValueKind != JsonValueKind.Array) return false;
        foreach (var item in arr.EnumerateArray())
        {
            projectId = MatchUriElement(item, entries);
            if (projectId != null) return true;
        }
        return false;
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
        return TryMatchUriArray(ctx, "fileSelections", entries, out projectId);
    }
}
