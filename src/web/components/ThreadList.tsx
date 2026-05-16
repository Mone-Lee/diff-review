/**
 * 评论线程列表：按锚点合并展示线程内容，并提供复制与状态切换操作。
 */
import React from 'react';
import { Card, Empty, Space, Tag, Typography } from 'antd';
import type { CommentAnchor, ReviewThread } from '../../shared/types';
import { formatAnchor } from '../utils';
import { InlineThreadGroup } from './InlineThreadCard';
import styles from '../styles.module.less';

type Props = {
  threads: ReviewThread[];
  focusedThreadId: string | null;
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

type ThreadGroup = {
  key: string;
  threads: ReviewThread[];
};

export function ThreadList({ threads, focusedThreadId, onPatch, onDeleteThread, onReply, onPatchComment, onDeleteComment, onCopy }: Props) {
  const groupRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const groups = React.useMemo(() => groupThreadsByAnchor(threads), [threads]);

  React.useEffect(() => {
    if (!focusedThreadId) return;
    const group = groups.find((item) => item.threads.some((thread) => thread.id === focusedThreadId));
    if (group) {
      groupRefs.current[group.key]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [focusedThreadId, groups]);

  if (groups.length === 0) {
    return <Empty className={styles.threadEmpty} description="暂无评论，悬停到行右侧或添加文件级评论即可开始。" />;
  }

  return (
    <div className={styles.threads}>
      {groups.map((group) => {
        const representative = group.threads[0];
        const groupStatus = getGroupStatus(group.threads);
        const isFocused = focusedThreadId ? group.threads.some((thread) => thread.id === focusedThreadId) : false;

        return (
          <Card
            className={[
              styles.thread,
              groupStatus === 'resolved' ? styles.resolved : '',
              isFocused ? (groupStatus === 'resolved' ? `${styles.threadFocused} ${styles.threadFocusedResolved}` : `${styles.threadFocused} ${styles.threadFocusedPending}`) : ''
            ]
              .filter(Boolean)
              .join(' ')}
            key={group.key}
            ref={(node) => {
              groupRefs.current[group.key] = node;
            }}
          >
            <Space className={styles.threadTop} align="start" size={8}>
              <Typography.Text className={styles.threadAnchor} strong>
                {representative ? formatAnchor(representative) : ''}
              </Typography.Text>
              <Tag className={`${styles.threadTag} ${statusTagClass(groupStatus)}`}>{groupStatus}</Tag>
            </Space>
            <div className={styles.threadListInlineBorderless}>
              <InlineThreadGroup
                threads={group.threads}
                showStatusTag={false}
                onFocus={() => undefined}
                onPatch={onPatch}
                onDeleteThread={onDeleteThread}
                onReply={onReply}
                onPatchComment={onPatchComment}
                onDeleteComment={onDeleteComment}
                onCopy={onCopy}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function groupThreadsByAnchor(threads: ReviewThread[]): ThreadGroup[] {
  const groups = new Map<string, ReviewThread[]>();
  for (const thread of threads) {
    const key = anchorKey(thread.anchor);
    groups.set(key, [...(groups.get(key) ?? []), thread]);
  }
  return Array.from(groups.entries()).map(([key, groupThreads]) => ({ key, threads: groupThreads }));
}

function anchorKey(anchor: CommentAnchor): string {
  if (anchor.type === 'file') return `file:${anchor.filePath}`;
  if (anchor.type === 'diff-line') return `diff:${anchor.filePath}:${anchor.side}:${anchor.lineNumber}`;
  return `markdown:${anchor.filePath}:${anchor.lineNumber}`;
}

function getGroupStatus(threads: ReviewThread[]): ReviewThread['status'] {
  if (threads.every((thread) => getThreadStatus(thread) === 'resolved')) return 'resolved';
  if (threads.some((thread) => getThreadStatus(thread) === 'replied')) return 'replied';
  return 'submit';
}

function statusTagClass(status: ReviewThread['status']): string {
  if (status === 'submit') return styles.threadTagSubmit;
  if (status === 'replied') return styles.threadTagReplied;
  return styles.threadTagResolved;
}

function getThreadStatus(thread: ReviewThread): ReviewThread['status'] {
  if (thread.status === 'resolved') return 'resolved';
  return thread.comments.some((comment) => comment.author === 'agent') ? 'replied' : 'submit';
}
