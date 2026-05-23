/**
 * Diff/Markdown 内容区内嵌评论卡：把已有评论直接展示在对应行下方。
 */
import React from 'react';
import type { ReviewThread } from '../../shared/types';
import { InlineThreadGroup } from './InlineThreadGroup';

type Props = {
  thread: ReviewThread;
  onFocus: (threadId: string) => void;
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

export function InlineThreadCard(props: Props) {
  return <InlineThreadGroup {...props} threads={[props.thread]} />;
}
