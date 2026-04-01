using System.Text.Json;
using CursorChatBrowser.Models;

namespace CursorChatBrowser.Services;

public class ConversationService(GlobalDataCache cache)
{
    /// <summary>
    /// Returns lightweight tab metadata for the sidebar. No bubble content
    /// is loaded -- this is effectively instant from the cached index.
    /// </summary>
    public async Task<List<ChatTabSummary>> GetConversationListAsync(string workspaceId)
    {
        if (cache.GetGlobalDbPath() == null)
            return [];
        await cache.EnsureIndexLoaded();
        return cache.GetTabSummariesForProject(workspaceId);
    }

    /// <summary>
    /// Loads full bubble content for a single conversation. Uses one SQLite
    /// connection with 3 queries instead of N connections for N conversations.
    /// </summary>
    public ChatTab? GetConversationDetail(string composerId)
    {
        var raw = cache.LoadConversationData(composerId);
        if (raw == null) return null;

        try
        {
            using var doc = JsonDocument.Parse(raw.ComposerJson);
            var composerData = doc.RootElement;

            var headers = composerData.TryGetProperty("fullConversationHeadersOnly", out var h)
                ? h : default;
            if (headers.ValueKind != JsonValueKind.Array) return null;

            var bubbles = new List<ChatBubble>();
            foreach (var header in headers.EnumerateArray())
            {
                if (!header.TryGetProperty("bubbleId", out var bid)) continue;
                var bubbleId = bid.GetString()!;
                if (!raw.Bubbles.TryGetValue(bubbleId, out var bubble)) continue;

                var isUser = header.TryGetProperty("type", out var t) && t.GetInt32() == 1;
                var text = ExtractTextFromBubble(bubble);

                foreach (var ctx in raw.MessageContexts)
                {
                    if (ctx.TryGetProperty("bubbleId", out var ctxBid) && ctxBid.GetString() == bubbleId)
                        text += ExtractContextText(ctx);
                }

                if (!string.IsNullOrWhiteSpace(text))
                {
                    var ts = bubble.TryGetProperty("timestamp", out var tsVal)
                        ? tsVal.GetInt64() : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    bubbles.Add(new ChatBubble(isUser ? "user" : "ai", text, ts));
                }
            }

            if (bubbles.Count == 0) return null;

            var title = composerData.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
                ? n.GetString()! : "";
            if (string.IsNullOrEmpty(title))
            {
                var firstLines = bubbles[0].Text.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                title = firstLines.Length > 0
                    ? (firstLines[0].Length > 100 ? firstLines[0][..100] + "..." : firstLines[0])
                    : $"Conversation {composerId[..Math.Min(8, composerId.Length)]}";
            }

            foreach (var diff in raw.CodeBlockDiffs)
            {
                var diffText = FormatToolAction(diff);
                if (!string.IsNullOrWhiteSpace(diffText))
                    bubbles.Add(new ChatBubble("ai", $"**Tool Action:**{diffText}",
                        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
            }

            bubbles.Sort((a, b) => a.Timestamp.CompareTo(b.Timestamp));

            var timestamp = composerData.TryGetProperty("lastUpdatedAt", out var lu) ? lu.GetInt64()
                : composerData.TryGetProperty("createdAt", out var ca) ? ca.GetInt64()
                : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            return new ChatTab(composerId, title, timestamp, bubbles);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error assembling conversation {composerId}: {ex.Message}");
            return null;
        }
    }

    public static string ExtractTextFromBubble(JsonElement bubble)
    {
        var text = "";
        if (bubble.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String)
            text = t.GetString()?.Trim() ?? "";

        if (string.IsNullOrEmpty(text) && bubble.TryGetProperty("richText", out var rt) && rt.ValueKind == JsonValueKind.String)
        {
            try
            {
                using var rtDoc = JsonDocument.Parse(rt.GetString()!);
                if (rtDoc.RootElement.TryGetProperty("root", out var root) &&
                    root.TryGetProperty("children", out var children))
                    text = ExtractTextFromRichText(children);
            }
            catch { }
        }

        if (bubble.TryGetProperty("codeBlocks", out var cbs) && cbs.ValueKind == JsonValueKind.Array)
        {
            foreach (var cb in cbs.EnumerateArray())
            {
                if (cb.TryGetProperty("content", out var content))
                {
                    var lang = cb.TryGetProperty("language", out var l) ? l.GetString() : "";
                    text += $"\n\n```{lang}\n{content.GetString()}\n```";
                }
            }
        }

        return text;
    }

    private static string ExtractTextFromRichText(JsonElement children)
    {
        var text = "";
        if (children.ValueKind != JsonValueKind.Array) return text;

        foreach (var child in children.EnumerateArray())
        {
            if (child.TryGetProperty("type", out var type))
            {
                if (type.GetString() == "text" && child.TryGetProperty("text", out var t))
                    text += t.GetString();
                else if (type.GetString() == "code" && child.TryGetProperty("children", out var cc))
                    text += "\n```\n" + ExtractTextFromRichText(cc) + "\n```\n";
            }
            if (child.TryGetProperty("children", out var ch) && ch.ValueKind == JsonValueKind.Array)
                text += ExtractTextFromRichText(ch);
        }
        return text;
    }

    private static string ExtractContextText(JsonElement ctx)
    {
        var result = "";
        if (ctx.TryGetProperty("gitStatusRaw", out var gs) && gs.ValueKind == JsonValueKind.String)
            result += $"\n\n**Git Status:**\n```\n{gs.GetString()}\n```";
        if (ctx.TryGetProperty("terminalFiles", out var tf) && tf.ValueKind == JsonValueKind.Array)
        {
            result += "\n\n**Terminal Files:**";
            foreach (var f in tf.EnumerateArray())
                if (f.TryGetProperty("path", out var p)) result += $"\n- {p.GetString()}";
        }
        return result;
    }

    private static string FormatToolAction(JsonElement action)
    {
        var result = "";
        if (action.TryGetProperty("filePath", out var fp))
            result += $"\n\n**File:** {fp.GetString()}";
        if (action.TryGetProperty("command", out var cmd))
            result += $"\n\n**Command:** `{cmd.GetString()}`";
        if (action.TryGetProperty("toolName", out var tn))
        {
            result += $"\n\n**Tool Action:** {tn.GetString()}";
            if (action.TryGetProperty("parameters", out var p))
            {
                try
                {
                    var paramsStr = p.ValueKind == JsonValueKind.String ? p.GetString()! : p.GetRawText();
                    using var pDoc = JsonDocument.Parse(paramsStr);
                    var pr = pDoc.RootElement;
                    if (pr.TryGetProperty("command", out var c)) result += $"\n**Command:** `{c.GetString()}`";
                    if (pr.TryGetProperty("target_file", out var tf)) result += $"\n**File:** {tf.GetString()}";
                }
                catch { }
            }
        }
        return result;
    }
}
