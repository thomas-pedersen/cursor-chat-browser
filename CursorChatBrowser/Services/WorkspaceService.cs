using CursorChatBrowser.Models;

namespace CursorChatBrowser.Services;

public class WorkspaceService(WorkspacePathResolver pathResolver, GlobalDataCache cache)
{
    public async Task<List<Project>> GetProjectsAsync()
    {
        var workspacePath = pathResolver.Resolve();
        if (!Directory.Exists(workspacePath))
            return [];

        await cache.EnsureIndexLoaded();

        var workspaceEntries = cache.GetWorkspaceEntries();
        var conversationCounts = cache.GetConversationCounts();
        var projects = new List<Project>();

        foreach (var entry in workspaceEntries)
        {
            var dbPath = Path.Combine(workspacePath, entry.Name, "state.vscdb");
            if (!File.Exists(dbPath)) continue;

            var stats = new FileInfo(dbPath);
            var folder = entry.Folder.Replace("file://", "");
            var folderName = folder.Split('/', '\\').LastOrDefault(s => !string.IsNullOrEmpty(s))
                          ?? $"Project {entry.Name[..Math.Min(8, entry.Name.Length)]}";

            conversationCounts.TryGetValue(entry.Name, out var count);

            projects.Add(new Project(
                entry.Name, folderName, folder, count, stats.LastWriteTimeUtc));
        }

        projects.Sort((a, b) => b.LastModified.CompareTo(a.LastModified));
        return projects;
    }

    public async Task<WorkspaceInfo?> GetWorkspaceAsync(string id)
    {
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
