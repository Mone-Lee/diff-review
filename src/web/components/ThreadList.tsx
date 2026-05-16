/**
 * 评论线程列表：展示线程内容，并提供复制与状态切换操作。
 */
import React from 'react';
import { Button, Card, Empty, Space, Tag, Typography } from 'antd';
import { CheckOutlined, CopyOutlined, ReloadOutlined, RedoOutlined } from '@ant-design/icons';
import type { ReviewThread } from '../../shared/types';
import { formatAnchor } from '../utils';
import { CommentComposer } from './CommentComposer';
import styles from '../styles.module.less';

type Props = {
  threads: ReviewThread[];
  focusedThreadId: string | null;
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

export function ThreadList({ threads, focusedThreadId, onPatch, onReply, onCopy }: Props) {
  const threadRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const [expandedComposer, setExpandedComposer] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!focusedThreadId) return;
    threadRefs.current[focusedThreadId]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focusedThreadId]);

  if (threads.length === 0) {
    return <Empty className={styles.threadEmpty} description="暂无评论，悬停到行右侧或添加文件级评论即可开始。" />;
  }

  return (
    <div className={styles.threads}>
      {threads.map((thread) => (
        <Card
          className={
            focusedThreadId === thread.id
              ? `${thread.status === 'resolved' ? `${styles.thread} ${styles.resolved} ${styles.threadFocusedResolved}` : `${styles.thread} ${styles.threadFocusedPending}`} ${styles.threadFocused}`
              : thread.status === 'resolved'
                ? `${styles.thread} ${styles.resolved}`
                : styles.thread
          }
          key={thread.id}
          bordered={false}
          ref={(node) => {
            threadRefs.current[thread.id] = node;
          }}
        >
          <Space className={styles.threadTop} align="start" size={8}>
            <Typography.Text className={styles.threadAnchor} strong>
              {formatAnchor(thread)}
            </Typography.Text>
            {
              thread.status === 'resolved' ? (
                <Tag className={`${styles.threadTag} ${styles.threadTagResolved}`}>resolved</Tag>
              ) : null
            }
            {/* <Tag className={thread.status === 'resolved' ? `${styles.threadTag} ${styles.threadTagResolved}` : `${styles.threadTag} ${styles.threadTagPending}`}>
              {thread.status === 'resolved' ? 'resolved' : ''}
            </Tag> */}
          </Space>
          {thread.comments.map((comment, index) => (
            <div className={index === 0 ? styles.threadComment : styles.threadReply} key={comment.id}>
              {index > 0 ? <Typography.Text className={styles.threadReplyLabel}>Reply {index} ({comment.author === 'agent' ? 'Agent' : 'User'})</Typography.Text> : null}
              <Typography.Paragraph className={styles.threadBody}>{comment.body}</Typography.Paragraph>
            </div>
          ))}
          {expandedComposer[thread.id] ? (
            <div className={styles.threadReplyComposer}>
              <CommentComposer
                placeholder="继续评论..."
                submitLabel="回复"
                onCancel={() => setExpandedComposer((prev) => ({ ...prev, [thread.id]: false }))}
                onSubmit={async (body) => {
                  await onReply(thread.id, body);
                  setExpandedComposer((prev) => ({ ...prev, [thread.id]: false }));
                }}
              />
            </div>
          ) : null}
          <div className={styles.threadActions}>
            {
              thread.status === 'resolved' ? null : (
                <>
                  <Button className={styles.threadActionBtn} icon={<RedoOutlined />} onClick={() => setExpandedComposer((prev) => ({ ...prev, [thread.id]: true }))}>
                    要求再改
                  </Button>
                  <Button className={styles.threadActionBtn} icon={<CopyOutlined />} onClick={() => void onCopy({ type: 'thread', threadId: thread.id })}>
                    复制
                  </Button>
                </>
              )
            }
            <Button
              className={styles.threadActionBtn}
              icon={thread.status === 'resolved' ? <ReloadOutlined /> : <CheckOutlined />}
              onClick={() => void onPatch(thread.id, thread.status === 'resolved' ? 'unresolved' : 'resolved')}
            >
              {thread.status === 'resolved' ? '重新打开' : '确认完成'}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
