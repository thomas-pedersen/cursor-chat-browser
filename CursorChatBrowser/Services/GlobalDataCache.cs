using System.Text.Json;
using Microsoft.Data.Sqlite;
using CursorChatBrowser.Models;

namespace CursorChatBrowser.Services;

public record ConversationRawData(
    string ComposerJson,
    Dictionary<string, JsonElement> Bubbles,
    List<JsonElement> CodeBlockDiffs,
    List<JsonElement> MessageContexts);

/// <summary>
/// Singleton cache for the global Cursor database. Re-reads only when the
/// DB file's last-write timestamp changes. Tab summaries are extracted during
/// index loading so the sidebar renders instantly; full bubble content is
/// loaded on demand for a single conversation at a time.
/// </summary>
public class GlobalDataCache(WorkspacePathResolver pathResolver)
{
    private readonly Lock _lock = new();
    private DateTime _lastModified;
    private string? _cachedDbPath;

    private Dictionary<string, string> _composerIdToProjectId = new();
    private Dictionary<string, int> _projectConversationCounts = new();
    private Dictionary<string, List<string>> _projectLayoutsMap = new();
    private Dictionary<string, string> _projectNameToWsId = new();
    private List<WorkspaceEntry> _workspaceEntries = [];
    private Dictionary<string, ChatTabSummary> _tabSummaries = new();
    private Dictionary<string, List<JsonElement>> _messageContextByComposer = new();

    public bool IsStale
    {
        get
        {
            var dbPath = GetGlobalDbPath();
            if (dbPath == null || !File.Exists(dbPath)) return true;
            return new FileInfo(dbPath).LastWriteTimeUtc != _lastModified;
        }
    }

    public string? GetGlobalDbPath()
    {
        var workspacePath = pathResolver.Resolve();
        var path = Path.Combine(workspacePath, "..", "globalStorage", "state.vscdb");
        return File.Exists(path) ? Path.GetFullPath(path) : null;
    }

    /// <summary>
    /// Loads the lightweight index: composer→project mapping, tab summaries
    /// (title + timestamp), and pre-indexed message context. Does NOT load
    /// bubble content. Fast enough for home page and sidebar rendering.
    /// </summary>
    public async Task EnsureIndexLoaded()
    {
        var dbPath = GetGlobalDbPath();
        if (dbPath == null) return;

        var mod = new FileInfo(dbPath).LastWriteTimeUtc;

        lock (_lock)
        {
            if (_cachedDbPath == dbPath && _lastModified == mod)
                return;
        }

        var workspacePath = pathResolver.Resolve();
        var dirs = Directory.GetDirectories(workspacePath);
        var wsEntries = new List<WorkspaceEntry>();
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
            wsEntries.Add(new WorkspaceEntry(name, wsJson, folder));
        }

        var pnToWsId = ProjectMapper.BuildProjectNameToWorkspaceIdMap(wsEntries);

        var msgCtxRows = SqliteHelper.QueryKv(dbPath,
            "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'messageRequestContext:%'");
        var plMap = ProjectMapper.BuildProjectLayoutsMap(msgCtxRows);

        // Pre-index message context by composerId for fast per-conversation lookups
        var msgCtxByComposer = new Dictionary<string, List<JsonElement>>();
        foreach (var (key, value) in msgCtxRows)
        {
            var parts = key.Split(':');
            if (parts.Length < 2) continue;
            var chatId = parts[1];
            try
            {
                using var doc = JsonDocument.Parse(value);
                if (!msgCtxByComposer.ContainsKey(chatId))
                    msgCtxByComposer[chatId] = [];
                msgCtxByComposer[chatId].Add(doc.RootElement.Clone());
            }
            catch { }
        }

        var composerRows = SqliteHelper.QueryKv(dbPath,
            "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND LENGTH(value) > 10");

        var idToProject = new Dictionary<string, string>();
        var counts = new Dictionary<string, int>();
        var tabSummaries = new Dictionary<string, ChatTabSummary>();

        foreach (var (key, value) in composerRows)
        {
            var composerId = key.Split(':').ElementAtOrDefault(1) ?? "";
            try
            {
                using var doc = JsonDocument.Parse(value);
                var root = doc.RootElement;

                var projectId = ProjectMapper.DetermineProjectForConversation(
                    root, composerId, plMap, pnToWsId, wsEntries,
                    new Dictionary<string, JsonElement>());

                if (projectId == null) continue;
                idToProject[composerId] = projectId;
                counts.TryAdd(projectId, 0);
                counts[projectId]++;

                // Extract tab summary if this composer has displayable content
                if (root.TryGetProperty("fullConversationHeadersOnly", out var headers)
                    && headers.ValueKind == JsonValueKind.Array
                    && headers.GetArrayLength() > 0)
                {
                    var title = root.TryGetProperty("name", out var nameEl)
                                && nameEl.ValueKind == JsonValueKind.String
                        ? nameEl.GetString() ?? "" : "";
                    if (string.IsNullOrEmpty(title))
                        title = $"Conversation {composerId[..Math.Min(8, composerId.Length)]}";

                    var timestamp = root.TryGetProperty("lastUpdatedAt", out var lu) ? lu.GetInt64()
                        : root.TryGetProperty("createdAt", out var ca) ? ca.GetInt64()
                        : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                    tabSummaries[composerId] = new ChatTabSummary(composerId, title, timestamp);
                }
            }
            catch { }
        }

        lock (_lock)
        {
            _cachedDbPath = dbPath;
            _lastModified = mod;
            _workspaceEntries = wsEntries;
            _projectNameToWsId = pnToWsId;
            _projectLayoutsMap = plMap;
            _composerIdToProjectId = idToProject;
            _projectConversationCounts = counts;
            _tabSummaries = tabSummaries;
            _messageContextByComposer = msgCtxByComposer;
        }
    }

    public List<WorkspaceEntry> GetWorkspaceEntries() { lock (_lock) return _workspaceEntries; }
    public Dictionary<string, int> GetConversationCounts() { lock (_lock) return _projectConversationCounts; }
    public Dictionary<string, string> GetComposerIdToProjectId() { lock (_lock) return _composerIdToProjectId; }
    public Dictionary<string, List<string>> GetProjectLayoutsMap() { lock (_lock) return _projectLayoutsMap; }
    public Dictionary<string, string> GetProjectNameToWsId() { lock (_lock) return _projectNameToWsId; }

    /// <summary>
    /// Returns lightweight tab summaries for the sidebar, sorted by most recent first.
    /// </summary>
    public List<ChatTabSummary> GetTabSummariesForProject(string workspaceId)
    {
        lock (_lock)
        {
            return _composerIdToProjectId
                .Where(kv => kv.Value == workspaceId)
                .Select(kv => _tabSummaries.GetValueOrDefault(kv.Key))
                .Where(s => s != null)
                .OrderByDescending(s => s!.Timestamp)
                .ToList()!;
        }
    }

    /// <summary>
    /// Loads all data needed to render a single conversation using ONE SQLite
    /// connection with 3 queries (composerData exact match + 2 prefix LIKEs).
    /// Message context comes from the pre-indexed cache.
    /// </summary>
    public ConversationRawData? LoadConversationData(string composerId)
    {
        var dbPath = GetGlobalDbPath();
        if (dbPath == null) return null;

        using var conn = new SqliteConnection($"Data Source={dbPath};Mode=ReadOnly");
        conn.Open();

        string? composerJson = null;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT value FROM cursorDiskKV WHERE key = @key";
            cmd.Parameters.AddWithValue("@key", $"composerData:{composerId}");
            composerJson = cmd.ExecuteScalar() as string;
        }
        if (composerJson == null) return null;

        var bubbles = new Dictionary<string, JsonElement>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT key, value FROM cursorDiskKV WHERE key LIKE @prefix";
            cmd.Parameters.AddWithValue("@prefix", $"bubbleId:{composerId}:%");
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var key = reader.GetString(0);
                var parts = key.Split(':');
                if (parts.Length < 3) continue;
                try
                {
                    using var doc = JsonDocument.Parse(reader.GetString(1));
                    bubbles[parts[2]] = doc.RootElement.Clone();
                }
                catch { }
            }
        }

        var diffs = new List<JsonElement>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT value FROM cursorDiskKV WHERE key LIKE @prefix";
            cmd.Parameters.AddWithValue("@prefix", $"codeBlockDiff:{composerId}:%");
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                try
                {
                    using var doc = JsonDocument.Parse(reader.GetString(0));
                    diffs.Add(doc.RootElement.Clone());
                }
                catch { }
            }
        }

        List<JsonElement> contexts;
        lock (_lock)
        {
            contexts = _messageContextByComposer.GetValueOrDefault(composerId) ?? [];
        }

        return new ConversationRawData(composerJson, bubbles, diffs, contexts);
    }
}
