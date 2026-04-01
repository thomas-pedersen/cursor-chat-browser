# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-04-01

### Changed
- **Complete port from Next.js/TypeScript to C#/.NET 10 Blazor** -- eliminates all Node.js, webpack, and npm dependencies. The EPERM build errors caused by webpack traversing Windows junction points no longer apply.
- 11 Next.js API routes replaced by 5 C# service classes (direct method calls, no HTTP layer).
- `better-sqlite3` (native Node module) replaced by `Microsoft.Data.Sqlite` (managed NuGet package).
- `pdfmake` replaced by `QuestPDF` for PDF generation.
- Markdown rendering handled by `Markdig` instead of client-side libraries.
- Tailwind CSS preserved via CDN script to maintain the original UI design.
- `.gitignore` updated for .NET build artifacts (`bin/`, `obj/`, `publish/`).

### Added
- **`GlobalDataCache` singleton** -- caches the global SQLite database index (composer-to-project mappings, conversation counts, tab metadata). Only reloads when the underlying `state.vscdb` file's timestamp changes. Eliminates redundant parsing of tens of thousands of JSON rows on every page load.
- **Lazy conversation loading** -- the workspace sidebar renders instantly from cached metadata (`ChatTabSummary`). Full bubble content loads on demand for the selected conversation only, using a single SQLite connection with 3 targeted queries instead of N connections for N conversations.
- **Client-side detail cache** -- previously viewed conversations are cached in the Blazor component, making tab switching instant without re-querying SQLite.
- **Pre-indexed message context** -- message context rows are parsed and indexed by composer ID during the one-time index load, eliminating per-request scanning.
- `WorkspacePathResolver` with Windows, macOS, Linux, WSL, and SSH remote detection.
- `ProjectMapper` for shared conversation-to-workspace mapping logic.

### Removed
- All Node.js dependencies (`node_modules`, `package.json` scripts, webpack, PostCSS, ESLint).
- `puppeteer` (was a dead dependency, never imported).
- `@shadcn/ui` npm package (UI components were already vendored as source files).
- `isomorphic-dompurify` (imported but never called).
