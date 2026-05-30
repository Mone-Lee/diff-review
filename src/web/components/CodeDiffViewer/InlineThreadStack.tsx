/**
 * InlineThreadStack 组件：在行内区域渲染评论线程组。
 */
import React from 'react';
import type { ReviewThread } from '../../../shared/types';
import { InlineThreadGroup } from '../InlineThreadGroup';
import styles from '../../styles.module.less';

type Props = {
  threads: ReviewThread[];
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

export function InlineThreadStack({
  threads,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onCopyThread
}: Props) {
  if (threads.length === 0) return null;

  return (
    <div className={styles.inlineThreadStack}>
      <InlineThreadGroup
        threads={threads}
        onFocus={onLocateThread}
        onPatch={onPatchThread}
        onDeleteThread={onDeleteThread}
        onReply={onReplyThread}
        onPatchComment={onPatchComment}
        onCopy={onCopyThread}
      />
    </div>
  );
}
