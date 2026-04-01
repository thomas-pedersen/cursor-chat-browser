using CursorChatBrowser.Models;
using Markdig;

namespace CursorChatBrowser.Services;

public static class DownloadService
{
    public static string ConvertToMarkdown(ChatTab tab)
    {
        var md = $"# {tab.Title}\n\n";
        md += $"_Created: {DateTimeOffset.FromUnixTimeMilliseconds(tab.Timestamp).LocalDateTime:f}_\n\n---\n\n";

        foreach (var bubble in tab.Bubbles)
        {
            md += $"### {(bubble.Type == "ai" ? "AI" : "User")}\n\n";
            md += string.IsNullOrEmpty(bubble.Text) && bubble.Type == "ai"
                ? "_[TERMINAL OUTPUT NOT INCLUDED]_\n\n"
                : bubble.Text + "\n\n";
            md += "---\n\n";
        }
        return md;
    }

    private static readonly MarkdownPipeline _pipeline =
        new MarkdownPipelineBuilder().DisableHtml().Build();

    public static string ConvertToHtml(ChatTab tab)
    {
        var markdown = ConvertToMarkdown(tab);
        var body = Markdown.ToHtml(markdown, _pipeline);

        return "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><title>"
            + System.Net.WebUtility.HtmlEncode(tab.Title)
            + "</title><style>"
            + "body{max-width:800px;margin:40px auto;padding:0 20px;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Arial,sans-serif;line-height:1.6;color:#333}"
            + "pre{background:#f5f5f5;padding:1em;overflow-x:auto;border-radius:4px;border:1px solid #ddd}"
            + "code{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:0.9em}"
            + "hr{border:none;border-top:1px solid #ddd;margin:2em 0}"
            + "@media(prefers-color-scheme:dark){body{background:#1a1a1a;color:#ddd}pre{background:#2d2d2d;border-color:#404040}}"
            + "</style></head><body>"
            + body
            + "</body></html>";
    }
}
