/**
 * 评论线程列表：展示线程内容，并提供复制与状态切换操作。
 */
import React from 'react';
import { Button, Card, Empty, Space, Tag, Typography } from 'antd';
import { CheckOutlined, CopyOutlined, ReloadOutlined } from '@ant-design/icons';
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
    return <Empty className={styles.threadEmpty} description="暂无评论，点击行号或添加文件级评论即可开始。" />;
  }

  return (
    <div className={styles.threads}>
      {threads.map((thread) => (
        <Card className={thread.status === 'resolved' ? `${styles.thread} ${styles.resolved}` : styles.thread} key={thread.id} bordered={false}>
          <Space className={styles.threadTop} align="start" size={8}>
            <Typography.Text className={styles.threadAnchor} strong>
              {formatAnchor(thread)}
            </Typography.Text>
            <Tag className={thread.status === 'resolved' ? `${styles.threadTag} ${styles.threadTagResolved}` : `${styles.threadTag} ${styles.threadTagPending}`}>
              {thread.status === 'resolved' ? 'resolved' : '待提交'}
            </Tag>
          </Space>
          {thread.comments.map((comment) => (
            <Typography.Paragraph className={styles.threadBody} key={comment.id}>
              {comment.body}
            </Typography.Paragraph>
          ))}
          <div className={styles.threadActions}>
            <Button className={styles.threadActionBtn} icon={<CopyOutlined />} onClick={() => void onCopy({ type: 'thread', threadId: thread.id })}>
              复制
            </Button>
            <Button
              className={styles.threadActionBtn}
              icon={thread.status === 'resolved' ? <ReloadOutlined /> : <CheckOutlined />}
              onClick={() => void onPatch(thread.id, thread.status === 'resolved' ? 'unresolved' : 'resolved')}
            >
              {thread.status === 'resolved' ? '重新打开' : '标记已解决'}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
