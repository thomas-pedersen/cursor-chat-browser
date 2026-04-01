using System.ComponentModel;
using System.Text;
using System.Text.Json;
using CursorChatBrowser.Models;
using ModelContextProtocol.Server;

namespace CursorChatBrowser.Services;

[McpServerToolType]
public static class McpTools
{
    [McpServerTool, Description(
        "Lists all Cursor projects with their conversation counts and last modified dates. " +
        "Use this to get an overview of which projects have chat history and how active they are.")]
    public static async Task<string> ListProjects(WorkspaceService workspaceSvc)
    {
        var projects = await workspaceSvc.GetProjectsAsync();
        var result = projects.Select(p => new
        {
            p.Id,
            p.Name,
            p.Path,
            p.ConversationCount,
            LastModified = p.LastModified.ToLocalTime().ToString("yyyy-MM-dd HH:mm")
        });
        return JsonSerializer.Serialize(result, JsonOptions);
    }

    [McpServerTool, Description(
        "Searches across all Cursor conversations by keyword. Returns matching conversations " +
        "with context snippets showing where the match was found. " +
        "The 'type' parameter filters by conversation type: 'all' (default), 'composer', or 'chat'.")]
    public static async Task<string> SearchConversations(
        SearchService searchSvc,
        [Description("The search query to find in conversation titles and messages")] string query,
        [Description("Filter by type: 'all', 'composer', or 'chat'. Defaults to 'all'.")] string type = "all")
    {
        var results = await searchSvc.SearchAsync(query, type);
        var output = results.Select(r => new
        {
            r.WorkspaceId,
            r.ChatId,
            r.ChatTitle,
            Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(r.Timestamp)
                .LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
            r.MatchingText,
            r.Type
        });
        return JsonSerializer.Serialize(output, JsonOptions);
    }

    [McpServerTool, Description(
        "Lists all conversations for a specific project. Returns conversation titles, " +
        "timestamps, and IDs that can be passed to GetConversationDetail. " +
        "Use ListProjects first to find the project ID.")]
    public static async Task<string> GetConversationList(
        ConversationService convSvc,
        [Description("The project/workspace ID from ListProjects")] string projectId)
    {
        var tabs = await convSvc.GetConversationListAsync(projectId);
        var output = tabs.Select(t => new
        {
            t.Id,
            t.Title,
            Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(t.Timestamp)
                .LocalDateTime.ToString("yyyy-MM-dd HH:mm")
        });
        return JsonSerializer.Serialize(output, JsonOptions);
    }

    [McpServerTool, Description(
        "Fetches the full message history of a single conversation including all user and AI messages. " +
        "Use SearchConversations or GetConversationList to find the conversation ID first. " +
        "Note: the current live conversation is not available until Cursor flushes it to storage.")]
    public static string GetConversationDetail(
        ConversationService convSvc,
        [Description("The conversation/composer ID from SearchConversations or GetConversationList")] string conversationId)
    {
        var tab = convSvc.GetConversationDetail(conversationId);
        if (tab == null)
            return JsonSerializer.Serialize(new { error = "Conversation not found" }, JsonOptions);

        var sb = new StringBuilder();
        sb.AppendLine($"# {tab.Title}");
        sb.AppendLine($"Timestamp: {DateTimeOffset.FromUnixTimeMilliseconds(tab.Timestamp).LocalDateTime:yyyy-MM-dd HH:mm}");
        sb.AppendLine($"Messages: {tab.Bubbles.Count}");
        sb.AppendLine();

        foreach (var bubble in tab.Bubbles)
        {
            var role = bubble.Type == "user" ? "## User" : "## AI";
            var time = DateTimeOffset.FromUnixTimeMilliseconds(bubble.Timestamp)
                .LocalDateTime.ToString("yyyy-MM-dd HH:mm");
            sb.AppendLine($"{role} ({time})");
            sb.AppendLine();
            sb.AppendLine(bubble.Text);
            sb.AppendLine();
        }

        return sb.ToString();
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}
