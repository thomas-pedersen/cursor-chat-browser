using CursorChatBrowser.Models;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CursorChatBrowser.Services;

public static class PdfService
{
    public static byte[] GeneratePdf(ChatTab tab)
    {
        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(40);
                page.DefaultTextStyle(x => x.FontSize(11));

                page.Header().Text(tab.Title).FontSize(22).Bold().FontColor(Colors.Blue.Darken2);

                page.Content().PaddingVertical(10).Column(col =>
                {
                    col.Spacing(8);

                    col.Item().Text(text =>
                    {
                        text.Span("Created: ").Italic();
                        text.Span(DateTimeOffset.FromUnixTimeMilliseconds(tab.Timestamp).LocalDateTime.ToString("f"));
                    });

                    col.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten2);

                    foreach (var bubble in tab.Bubbles)
                    {
                        if (string.IsNullOrWhiteSpace(bubble.Text)) continue;

                        col.Item().Text(bubble.Type == "user" ? "User" : "AI")
                            .FontSize(13).Bold()
                            .FontColor(bubble.Type == "user" ? Colors.Blue.Darken1 : Colors.Grey.Darken2);

                        col.Item().Text(bubble.Text).FontSize(10).LineHeight(1.4f);
                        col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten3);
                    }
                });

                page.Footer().AlignCenter().Text(text =>
                {
                    text.Span("Page ");
                    text.CurrentPageNumber();
                    text.Span(" of ");
                    text.TotalPages();
                });
            });
        });

        using var ms = new MemoryStream();
        document.GeneratePdf(ms);
        return ms.ToArray();
    }
}
