import React from 'react';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../shared/types';
import {
  createReviewThread,
  deleteReviewThread,
  patchReviewComment,
  patchReviewThread,
  type PromptScope,
  replyReviewThread,
  requestReviewPrompt
} from '../api/review';

export type LocateTarget = { threadId: string; anchor: CommentAnchor };

export type ReviewActions = {
  createThread: (anchor: CommentAnchor, body: string) => Promise<void>;
  patchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  replyThread: (id: string, body: string) => Promise<void>;
  patchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  copyPrompt: (scope: PromptScope) => Promise<void>;
};

export type ReviewNavigationActions = {
  locateThread: (threadId: string) => void;
};

type UseReviewActionsOptions = {
  refreshReviewState: () => Promise<void>;
  onPromptCopied: () => void;
};

type UseReviewNavigationActionsOptions = {
  files: DiffFile[];
  threads: ReviewThread[];
  setSelectedPath: React.Dispatch<React.SetStateAction<string>>;
  setLocateTarget: React.Dispatch<React.SetStateAction<LocateTarget | null>>;
  setFocusedThreadId: React.Dispatch<React.SetStateAction<string | null>>;
};

type ReviewActionsProviderProps = {
  value: ReviewActions;
  children: React.ReactNode;
};

type ReviewNavigationActionsProviderProps = {
  value: ReviewNavigationActions;
  children: React.ReactNode;
};

const ReviewActionsContext = React.createContext<ReviewActions | null>(null);
const ReviewNavigationActionsContext = React.createContext<ReviewNavigationActions | null>(null);

/**
 * 组合评论修改动作：请求交给 api 层，这里只负责串联刷新和复制成功后的页面反馈。
 */
export function useReviewActionsValue({
  refreshReviewState,
  onPromptCopied
}: UseReviewActionsOptions) {
  const createThread = React.useCallback(async (anchor: CommentAnchor, body: string) => {
    await createReviewThread(anchor, body);
    await refreshReviewState();
  }, [refreshReviewState]);

  const patchThread = React.useCallback(async (id: string, status: ReviewThread['status']) => {
    await patchReviewThread(id, status);
    await refreshReviewState();
  }, [refreshReviewState]);

  const deleteThread = React.useCallback(async (id: string) => {
    await deleteReviewThread(id);
    await refreshReviewState();
  }, [refreshReviewState]);

  const replyThread = React.useCallback(async (id: string, body: string) => {
    await replyReviewThread(id, body);
    await refreshReviewState();
  }, [refreshReviewState]);

  const patchComment = React.useCallback(async (threadId: string, commentId: string, body: string) => {
    await patchReviewComment(threadId, commentId, body);
    await refreshReviewState();
  }, [refreshReviewState]);

  const copyPrompt = React.useCallback(async (scope: PromptScope) => {
    const data = await requestReviewPrompt(scope);
    await navigator.clipboard.writeText(data.prompt);
    onPromptCopied();
  }, [onPromptCopied]);

  return React.useMemo<ReviewActions>(() => ({
    createThread,
    patchThread,
    deleteThread,
    replyThread,
    patchComment,
    copyPrompt
  }), [copyPrompt, createThread, deleteThread, patchComment, patchThread, replyThread]);
}

/**
 * 组合评论导航动作：依赖当前文件和评论快照，用于把线程定位回对应文件和锚点。
 */
export function useReviewNavigationActionsValue({
  files,
  threads,
  setSelectedPath,
  setLocateTarget,
  setFocusedThreadId
}: UseReviewNavigationActionsOptions) {
  const locateThread = React.useCallback((threadId: string) => {
    const target = threads.find((thread) => thread.id === threadId);
    if (target) {
      const fileExists = files.some((file) => file.path === target.filePath);
      if (fileExists) {
        setSelectedPath(target.filePath);
      }
      setLocateTarget({ threadId, anchor: target.anchor });
    }
    setFocusedThreadId(threadId);
  }, [files, setFocusedThreadId, setLocateTarget, setSelectedPath, threads]);

  return React.useMemo<ReviewNavigationActions>(() => ({
    locateThread
  }), [locateThread]);
}

/**
 * 统一向审查子树注入已经组装完成的评论动作。
 */
export function ReviewActionsProvider({ value, children }: ReviewActionsProviderProps) {
  return <ReviewActionsContext.Provider value={value}>{children}</ReviewActionsContext.Provider>;
}

/**
 * 统一向审查子树注入评论导航动作。
 */
export function ReviewNavigationActionsProvider({ value, children }: ReviewNavigationActionsProviderProps) {
  return <ReviewNavigationActionsContext.Provider value={value}>{children}</ReviewNavigationActionsContext.Provider>;
}

/**
 * 从最近的审查动作上下文读取评论操作。
 */
export function useReviewActions() {
  const value = React.useContext(ReviewActionsContext);
  if (!value) {
    throw new Error('useReviewActions must be used within ReviewActionsProvider');
  }
  return value;
}

/**
 * 从最近的审查导航上下文读取评论定位操作。
 */
export function useReviewNavigationActions() {
  const value = React.useContext(ReviewNavigationActionsContext);
  if (!value) {
    throw new Error('useReviewNavigationActions must be used within ReviewNavigationActionsProvider');
  }
  return value;
}
