import type { CommentAnchor, DiffFile, ReviewThread } from './types';

export function sameAnchor(left: CommentAnchor, right: CommentAnchor): boolean {
  if (left.type !== right.type || left.filePath !== right.filePath) return false;
  if (left.type === 'file' && right.type === 'file') return true;
  if (left.type === 'diff-line' && right.type === 'diff-line') {
    return left.side === right.side && left.lineNumber === right.lineNumber;
  }
  if (left.type === 'markdown-line' && right.type === 'markdown-line') {
    return left.lineNumber === right.lineNumber;
  }
  return false;
}

export function anchorKey(anchor: CommentAnchor): string {
  if (anchor.type === 'file') return `file:${anchor.filePath}`;
  if (anchor.type === 'diff-line') return `diff:${anchor.filePath}:${anchor.side}:${anchor.lineNumber}`;
  return `markdown:${anchor.filePath}:${anchor.lineNumber}`;
}

export function isThreadOnFileSnapshot(thread: ReviewThread, file: DiffFile): boolean {
  return thread.filePath === file.path && thread.fileSnapshotHash === file.snapshotHash;
}

export function getThreadStatus(thread: ReviewThread): ReviewThread['status'] {
  if (thread.status === 'resolved') return 'resolved';
  return getOpenThreadStatus(thread);
}

export function getOpenThreadStatus(thread: Pick<ReviewThread, 'comments'>): ReviewThread['status'] {
  return thread.comments.some((comment) => comment.author === 'agent') ? 'replied' : 'submit';
}

export function getMergedThreadStatus(threads: ReviewThread[]): ReviewThread['status'] {
  if (threads.length > 0 && threads.every((thread) => getThreadStatus(thread) === 'resolved')) return 'resolved';
  return threads.some((thread) => getOpenThreadStatus(thread) === 'replied') ? 'replied' : 'submit';
}
