using CursorChatBrowser.Components;
using CursorChatBrowser.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddSingleton<WorkspacePathResolver>();
builder.Services.AddSingleton<GlobalDataCache>();
builder.Services.AddScoped<WorkspaceService>();
builder.Services.AddScoped<ConversationService>();
builder.Services.AddScoped<SearchService>();

QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
}

app.UseAntiforgery();
app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

app.Run();
