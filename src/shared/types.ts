/**
 * 审查模式决定本次 diff 的来源：
 * `working` 表示审查工作区变更；带 base 时表示从某个 ref 到当前工作树的完整对比；
 * `staged` 表示审查已经 git add 但尚未提交的变更；
 * `revision` 表示审查两个 revision 之间的差异，base/target 可以是 commit、branch 或 tag。
 */
export type ReviewMode =
  | { kind: 'working'; base?: string }
  | { kind: 'staged' }
  | { kind: 'revision'; base: string; target: string; targetLabel?: string };

export type GitCommitSummary = {
  hash: string;
  shortHash: string;
  subject: string;
};

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
  /** 当前文件 diff 内容的摘要，用于保持未变化文件上的评论挂载。 */
  snapshotHash: string;
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

// review 页面刷新协议版本；CLI 与服务端通过它判断是否可以安全复用运行中的页面。
export const REVIEW_REFRESH_PROTOCOL = 3;

export type ReviewThread = {
  id: string;
  filePath: string;
  anchor: CommentAnchor;
  /** 创建此评论时的整份 diff 快照，仅用于兼容旧存储和追溯来源。 */
  diffHash?: string;
  /** 此评论所属文件的 diff 快照；其他文件变化不会影响当前文件评论挂载。 */
  fileSnapshotHash?: string;
  status: ReviewThreadStatus;
  comments: ReviewComment[];
  createdAt: string;
  updatedAt: string;
};

export type ReviewSession = {
  /** 本次审查快照的唯一标识；每次启动 review 时重新生成。 */
  id: string;
  /** 当前审查目标仓库的目录名，用于界面展示。 */
  repoName: string;
  /** 当前审查目标仓库的绝对根路径，用于读取 diff 内容和关联评论存储。 */
  repoRoot: string;
  /** 当前审查范围，例如工作区变更、暂存区变更或两个 revision 之间的差异。 */
  mode: ReviewMode;
  /** 启动时 diff 内容的摘要，用于标识本次审查对应的代码快照。 */
  diffHash: string;
  /** 本次审查快照创建时间，使用 ISO 时间字符串。 */
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

export type ReviewWatchEvent =
  | { type: 'connected'; hasPendingChanges: boolean }
  | { type: 'change'; hasPendingChanges: true; changedAt: string }
  | { type: 'synced'; hasPendingChanges: false };

export const COMMENT_STATUS_TEXT_MAP: Record<ReviewThreadStatus, string> = {
  submit: '待提交',
  replied: '已回复',
  resolved: '已解决'
};
