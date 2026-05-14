/**
 * 评论线程列表：展示线程内容，并提供复制与状态切换操作。
 */
import React from 'react';
import type { ReviewThread } from '../../shared/types';
import { formatAnchor } from '../utils';
import styles from '../styles.module.less';

type Props = {
  threads: ReviewThread[];
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

export function ThreadList({ threads, onPatch, onCopy }: Props) {
  if (threads.length === 0) {
    return <p className={styles.muted}>暂无评论。点击行号或添加文件级评论即可开始。</p>;
  }

  return (
    <div className={styles.threads}>
      {threads.map((thread) => (
        <article className={thread.status === 'resolved' ? `${styles.thread} ${styles.resolved}` : styles.thread} key={thread.id}>
          <strong>{formatAnchor(thread)}</strong>
          {thread.comments.map((comment) => (
            <p key={comment.id}>{comment.body}</p>
          ))}
          <div className={styles.threadActions}>
            <button onClick={() => void onCopy({ type: 'thread', threadId: thread.id })}>复制</button>
            <button onClick={() => void onPatch(thread.id, thread.status === 'resolved' ? 'unresolved' : 'resolved')}>
              {thread.status === 'resolved' ? '重新打开' : '标记已解决'}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
