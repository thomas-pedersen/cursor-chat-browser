namespace CursorChatBrowser.Models;

public record Project(
    string Id,
    string Name,
    string? Path,
    int ConversationCount,
    DateTime LastModified
);

public record ChatBubble(
    string Type, // "user" or "ai"
    string Text,
    long Timestamp
);

public record ChatTab(
    string Id,
    string Title,
    long Timestamp,
    List<ChatBubble> Bubbles,
    List<CodeBlockDiff>? CodeBlockDiffs = null
);

public record CodeBlockDiff(
    string? DiffId,
    object? NewModelDiffWrtV0,
    object? OriginalModelDiffWrtV0
);

public record SearchResult(
    string WorkspaceId,
    string? WorkspaceFolder,
    string ChatId,
    string ChatTitle,
    long Timestamp,
    string MatchingText,
    string Type // "chat" or "composer"
);

public record WorkspaceLog(
    string Id,
    string WorkspaceId,
    string? WorkspaceFolder,
    string Title,
    long Timestamp,
    string Type, // "chat" or "composer"
    int MessageCount
);

public record WorkspaceInfo(
    string Id,
    string DbPath,
    string? Folder,
    DateTime LastModified
);

public record WorkspaceEntry(
    string Name,
    string WorkspaceJsonPath,
    string Folder
);

public record ChatTabSummary(
    string Id,
    string Title,
    long Timestamp
);

public record ConversationResponse(
    List<ChatTab> Tabs
);
