export interface Selection {
  text: string;
}

export interface ChatBubble {
  type: 'ai' | 'user';
  text?: string;
  modelType?: string;
  selections?: Selection[];
  timestamp?: number;
}

export interface ChatTab {
  id: string;
  title: string;
  timestamp: number;
  bubbles: {
    type: 'user' | 'ai'
    text: string
    timestamp: number
  }[];
  codeBlockDiffs?: {
    diffId: string
    newModelDiffWrtV0: any[]
    originalModelDiffWrtV0: any[]
  }[];
}

export interface Workspace {
  id: string;
  path: string;
  folder?: string;
  lastModified: string;
  chatCount: number;
}

// Composer types
export interface FileSelection {
  uri: {
    $mid: number;
    fsPath: string;
    _sep: number;
    external: string;
    path: string;
    scheme: string;
    authority: string;
  };
  isCurrentFile?: boolean;
  addedWithoutMention?: boolean;
  fileName?: string;
}

export interface FolderSelection {
  path: string;
  name: string;
}

export interface DocSelection {
  id: string;
  title: string;
  content: string;
}

export interface CommitSelection {
  hash: string;
  message: string;
  date: string;
}

export interface ComposerContext {
  notepads: string[];
  selections: Selection[];
  fileSelections: FileSelection[];
  folderSelections: FolderSelection[];
  selectedDocs: DocSelection[];
  selectedCommits: CommitSelection[];
}

export interface ComposerMessage {
  type: 1 | 2;  // 1 for user, 2 for assistant
  bubbleId: string;
  text: string;
  richText: string;
  context: ComposerContext;
  timestamp: number;
}

export interface ComposerChat {
  composerId: string;
  conversation?: ComposerMessage[];
  richText: string;
  text: string;
  status: string;
  context: ComposerContext;
  lastUpdatedAt: number;
  createdAt: number;
  name: string;
}

export interface ComposerData {
  allComposers: ComposerChat[];
  selectedComposerId: string;
  composerDataVersion: number;
}

// Add this interface
export interface MarkdownCodeProps {
  node?: any;
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}
