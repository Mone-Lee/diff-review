/**
 * Review API 封装：负责前端与 review 会话、评论线程、评论编辑和 prompt 生成接口之间的通信。
 */
import type { CommentAnchor, DiffFile, GitCommitSummary, ReviewMode, ReviewSession, ReviewThread, ReviewWatchEvent } from '../../shared/types';

export type PromptScope = { type: 'thread'; threadId: string } | { type: 'file-unresolved'; filePath: string } | { type: 'all-unresolved' };

export type ReviewState = {
  session: ReviewSession;
  files: DiffFile[];
  threads: ReviewThread[];
};

export type CompareOptions = {
  defaultBase?: string;
  recentCommits: GitCommitSummary[];
};

/**
 * 读取当前 review 会话的完整状态快照。
 */
export async function fetchReviewState() {
  const res = await fetch('/api/review-state');
  return (await res.json()) as ReviewState;
}

/**
 * 主动请求服务端基于当前仓库状态重算最新 diff 快照。
 */
export async function refreshReviewSnapshot() {
  const res = await fetch('/api/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: '刷新 diff 失败' }))) as { error?: string };
    throw new Error(data.error ?? '刷新 diff 失败');
  }

  return (await res.json()) as ReviewState;
}

/**
 * 读取版本对比入口需要的默认 base 和最近提交列表。
 */
export async function fetchCompareOptions() {
  const res = await fetch('/api/compare-options');
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: '读取版本列表失败' }))) as { error?: string };
    throw new Error(data.error ?? '读取版本列表失败');
  }
  return (await res.json()) as CompareOptions;
}

/**
 * 根据用户选择的版本范围切换当前 review 快照。
 */
export async function applyReviewComparison(mode: ReviewMode) {
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode })
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: '切换对比失败' }))) as { error?: string };
    throw new Error(data.error ?? '切换对比失败');
  }

  return (await res.json()) as ReviewState;
}

/**
 * 建立文件监听事件流，用于通知前端出现了可刷新的仓库变更。
 */
export function createReviewWatchEventSource() {
  return new EventSource('/api/watch');
}

export type { ReviewWatchEvent };

/**
 * 创建新的评论线程。
 */
export async function createReviewThread(anchor: CommentAnchor, body: string) {
  await fetch('/api/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: anchor.filePath, anchor, body })
  });
}

/**
 * 更新评论线程状态，并在失败时抛出统一错误。
 */
export async function patchReviewThread(id: string, status: ReviewThread['status']) {
  const res = await fetch(`/api/threads/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: '更新评论状态失败' }))) as { error?: string };
    throw new Error(data.error ?? '更新评论状态失败');
  }
}

/**
 * 删除指定评论线程。
 */
export async function deleteReviewThread(id: string) {
  await fetch(`/api/threads/${id}`, { method: 'DELETE' });
}

/**
 * 向评论线程追加一条用户回复。
 */
export async function replyReviewThread(id: string, body: string) {
  await fetch(`/api/threads/${id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, author: 'user' })
  });
}

/**
 * 更新指定评论内容，并在失败时抛出统一错误。
 */
export async function patchReviewComment(threadId: string, commentId: string, body: string) {
  if (!commentId) {
    throw new Error('Comment id is required');
  }

  const res = await fetch(`/api/threads/${threadId}/comments/${commentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: '编辑评论失败' }))) as { error?: string };
    throw new Error(data.error ?? '编辑评论失败');
  }
}

/**
 * 根据指定范围生成批量 prompt。
 */
export async function requestReviewPrompt(scope: PromptScope) {
  const res = await fetch('/api/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scope)
  });
  return (await res.json()) as { prompt: string };
}
