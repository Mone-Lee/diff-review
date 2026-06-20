/**
 * Web 层通用格式化工具：提供会话模式与评论锚点的展示文本转换。
 */
import type { ReviewSession, ReviewThread } from '../../shared/types';

export function modeLabel(session: ReviewSession): string {
  if (session.mode.kind === 'revision') return `范围：${session.mode.base}..${session.mode.target}`;
  if (session.mode.kind === 'staged') return '范围：暂存区';
  if (session.mode.kind === 'working') return '范围：工作区';
  return '范围：未知';
}

export function formatAnchor(thread: ReviewThread): string {
  if (thread.anchor.type === 'file') return thread.filePath;
  if (thread.anchor.type === 'diff-line') return `${thread.filePath}:${thread.anchor.side}:${thread.anchor.lineNumber}`;
  return `${thread.filePath}:${thread.anchor.lineNumber}`;
}

export function formatFileStatus(status: string): string {
  if (status === 'added') return 'A';
  if (status === 'modified') return 'M';
  if (status === 'deleted') return 'D';
  if (status === 'renamed') return 'R';
  return status;
}
