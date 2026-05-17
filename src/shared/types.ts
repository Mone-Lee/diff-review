/**
 * 审查模式决定本次 diff 的来源：
 * `working` 表示审查工作区中尚未暂存的变更；
 * `staged` 表示审查已经 git add 但尚未提交的变更；
 * `revision` 表示审查两个 revision 之间的差异，base/target 可以是 commit、branch 或 tag。
 */
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
  author?: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
};

export type ReviewThreadStatus = 'submit' | 'replied' | 'resolved';

export type ReviewThread = {
  id: string;
  filePath: string;
  anchor: CommentAnchor;
  status: ReviewThreadStatus;
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


export const COMMENT_STATUS_TEXT_MAP: Record<ReviewThreadStatus, string> = {
  submit: '待提交',
  replied: '已回复',
  resolved: '已解决'
};