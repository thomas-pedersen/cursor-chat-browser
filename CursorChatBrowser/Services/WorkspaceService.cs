using System.Text.RegularExpressions;
using CursorChatBrowser.Models;

namespace CursorChatBrowser.Services;

public partial class WorkspaceService(WorkspacePathResolver pathResolver, GlobalDataCache cache)
{
    [GeneratedRegex(@"^[a-zA-Z0-9_\-]+$")]
    private static partial Regex SafeDirectoryName();

    private static bool IsValidWorkspaceId(string id) =>
        !string.IsNullOrEmpty(id) && SafeDirectoryName().IsMatch(id);
    public async Task<List<Project>> GetProjectsAsync()
    {
        var workspacePath = pathResolver.Resolve();
        if (!Directory.Exists(workspacePath))
            return [];

        await cache.EnsureIndexLoaded();

        var workspaceEntries = cache.GetWorkspaceEntries();
        var conversationCounts = cache.GetConversationCounts();
        var wsIdToCanonical = cache.GetWsIdToCanonical();

        // Build one entry per workspace, then merge duplicates that share
        // the same physical folder (via canonical workspace ID mapping).
        var merged = new Dictionary<string, Project>();

        foreach (var entry in workspaceEntries)
        {
            var dbPath = Path.Combine(workspacePath, entry.Name, "state.vscdb");
            if (!File.Exists(dbPath)) continue;

            var canonicalId = wsIdToCanonical.GetValueOrDefault(entry.Name, entry.Name);
            var stats = new FileInfo(dbPath);
            conversationCounts.TryGetValue(entry.Name, out var count);

            if (merged.TryGetValue(canonicalId, out var existing))
            {
                merged[canonicalId] = existing with
                {
                    ConversationCount = existing.ConversationCount + count,
                    LastModified = stats.LastWriteTimeUtc > existing.LastModified
                        ? stats.LastWriteTimeUtc : existing.LastModified
                };
            }
            else
            {
                var folder = ProjectMapper.NormalizePath(entry.Folder);
                var folderName = folder.Split('/').LastOrDefault(s => !string.IsNullOrEmpty(s))
                              ?? $"Project {entry.Name[..Math.Min(8, entry.Name.Length)]}";

                merged[canonicalId] = new Project(
                    canonicalId, folderName, folder, count, stats.LastWriteTimeUtc);
            }
        }

        var projects = merged.Values.ToList();
        projects.Sort((a, b) => b.LastModified.CompareTo(a.LastModified));
        return projects;
    }

    public async Task<WorkspaceInfo?> GetWorkspaceAsync(string id)
    {
        if (!IsValidWorkspaceId(id)) return null;
        var workspacePath = pathResolver.Resolve();
        var dbPath = Path.Combine(workspacePath, id, "state.vscdb");
        if (!File.Exists(dbPath)) return null;

        var stats = new FileInfo(dbPath);
        string? folder = null;

        var wsJsonPath = Path.Combine(workspacePath, id, "workspace.json");
        if (File.Exists(wsJsonPath))
        {
            try
            {
                var json = await File.ReadAllTextAsync(wsJsonPath);
                using var doc = System.Text.Json.JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("folder", out var f))
                    folder = f.GetString();
            }
            catch { }
        }

        return new WorkspaceInfo(id, dbPath, folder, stats.LastWriteTimeUtc);
    }

    public int CountWorkspaces(string path)
    {
        if (!Directory.Exists(path)) return 0;
        return Directory.GetDirectories(path)
            .Count(dir => File.Exists(Path.Combine(dir, "state.vscdb")));
    }
}
