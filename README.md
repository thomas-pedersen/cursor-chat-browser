# Cursor Chat Browser

A web application for browsing and managing chat histories from the Cursor editor's AI chat feature. View, search, and export your AI conversations in various formats.

This is a C#/.NET 10 Blazor port of the original [cursor-chat-browser](https://github.com/thomas-pedersen/cursor-chat-browser) (Next.js/TypeScript).

## Features

- Browse and search all workspaces with Cursor chat history
- Support for both workspace-specific and global storage (newer Cursor versions)
- View both AI chat logs and Composer logs
- Organize chats by workspace
- Full-text search across all conversations
- Dark/light mode with system preference detection
- Export chats as Markdown, HTML (with syntax highlighting), or PDF
- Syntax-highlighted code blocks via Prism.js
- Bookmarkable chat URLs
- Automatic workspace path detection (Windows, macOS, Linux, WSL, SSH remote)

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- A Cursor editor installation with chat history

## Quick Start

```bash
git clone https://github.com/thomas-pedersen/cursor-chat-browser.git
cd cursor-chat-browser
dotnet run --project CursorChatBrowser
```

Open [http://localhost:5169](http://localhost:5169) in your browser.

## Configuration

The application automatically detects your Cursor workspace storage location:

| OS | Default Path |
|----|-------------|
| Windows | `%APPDATA%\Cursor\User\workspaceStorage` |
| WSL2 | `/mnt/c/Users/<USERNAME>/AppData/Roaming/Cursor/User/workspaceStorage` |
| macOS | `~/Library/Application Support/Cursor/User/workspaceStorage` |
| Linux | `~/.config/Cursor/User/workspaceStorage` |
| Linux (remote/SSH) | `~/.cursor-server/data/User/workspaceStorage` |

If automatic detection fails, set the path manually on the Configuration page.

## Architecture

The app is a **Blazor Web App with Interactive Server rendering**. All data access (SQLite reads of Cursor's `state.vscdb`) happens server-side with results pushed to the browser over SignalR.

```
Browser  ──SignalR──▶  Blazor Server
                         ├── WorkspaceService   ─┐
                         ├── ConversationService  ├──▶ state.vscdb (SQLite, read-only)
                         ├── SearchService       ─┘
                         └── PdfService (QuestPDF)
```

Key libraries:
- **Microsoft.Data.Sqlite** -- SQLite access (replaces better-sqlite3)
- **Markdig** -- Markdown rendering
- **QuestPDF** -- PDF generation
- **Tailwind CSS** (CDN) -- Styling, preserving the original UI design

### Performance

A `GlobalDataCache` singleton caches the database index (composer-to-project mappings, tab metadata) and only reloads when the underlying `state.vscdb` file changes. Conversation content loads lazily -- the sidebar renders instantly from cached metadata, and full bubble content loads on demand for the selected conversation through a single SQLite connection.

## Development

```bash
cd CursorChatBrowser
dotnet watch
```

This enables hot reload for Razor components and C# code changes.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
