# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2024-12-19

### Added
- Support for Cursor's new global storage system for chat data
- Global storage detection and reading for newer chat threads
- Visual indicators for global storage chats in logs and search results

### Fixed
- Chat logs not rendering for newer threads stored in global storage
- Compatibility with Cursor's migration from workspace-specific to global chat storage
- Search functionality now includes global storage chat data

## [0.2.1] - 2024-11-27

### Fixed
- Search functionality for composer logs with undefined conversation property
- Error handling in composer list view
- Improved robustness of search across workspaces
- Handling of missing workspace.json files
- Type safety for composer conversation arrays

## [0.2.0] - 2024-11-04

### Added
- Composer logs browsing functionality
- Unified search across chat and composer logs
- Search filters for chat/composer logs
- Type badges in search results
- Footer with GitHub repository link
- Combined logs view with type indicators
- Workspace overview with chat and composer counts

### Changed
- Search placeholder text to include composer logs
- Improved navigation with separate buttons for chat and composer logs
- Enhanced workspace list with composer count column
- Search results now link directly to specific log types

## [0.1.0] - 2024-11-01

### Added
- Initial release
- Browse AI chat logs by workspace
- View chat conversations with syntax highlighting
- Export chats as Markdown, HTML, or PDF
- Dark/light mode support
- Basic search functionality
- Configuration page for workspace path 