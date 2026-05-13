export type ReviewMode =
  | { kind: 'working' }
  | { kind: 'staged' }
  | { kind: 'revision'; base: string; target: string };

export type DiffLineType = 'context' | 'add' | 'remove';

export type DiffLine = {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type DiffFile = {
  oldPath: string;
  newPath: string;
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  isMarkdown: boolean;
  hunks: DiffHunk[];
};

export type CommentAnchor =
  | { type: 'file'; filePath: string }
  | { type: 'diff-line'; filePath: string; side: 'old' | 'new'; lineNumber: number }
  | { type: 'markdown-line'; filePath: string; lineNumber: number; blockId?: string };

export type ReviewComment = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type ReviewThread = {
  id: string;
  filePath: string;
  anchor: CommentAnchor;
  status: 'unresolved' | 'resolved';
  comments: ReviewComment[];
  createdAt: string;
  updatedAt: string;
};

export type ReviewSession = {
  id: string;
  repoRoot: string;
  mode: ReviewMode;
  diffHash: string;
  createdAt: string;
};

export type MarkdownBlock = {
  id: string;
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'blockquote' | 'other';
  startLine: number;
  endLine: number;
  text: string;
};

export type MarkdownPreview = {
  filePath: string;
  content: string;
  deleted: boolean;
  blocks: MarkdownBlock[];
};

export type PromptScope =
  | { type: 'thread'; threadId: string }
  | { type: 'file-unresolved'; filePath: string }
  | { type: 'all-unresolved' };
