using CursorChatBrowser.Components;
using CursorChatBrowser.Services;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Server;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddSingleton<WorkspacePathResolver>();
builder.Services.AddSingleton<GlobalDataCache>();
builder.Services.AddScoped<WorkspaceService>();
builder.Services.AddScoped<ConversationService>();
builder.Services.AddScoped<SearchService>();

builder.Services.AddMcpServer()
    .WithHttpTransport(options => options.Stateless = true)
    .WithToolsFromAssembly();

QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
}

app.UseAntiforgery();
app.MapStaticAssets();
app.MapMcp("/mcp");
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
