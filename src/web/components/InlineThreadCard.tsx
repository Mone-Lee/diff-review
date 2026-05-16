/**
 * Diff/Markdown 内容区内嵌评论卡：把已有评论直接展示在对应行下方。
 */
import React from 'react';
import { Button, Tag, Typography } from 'antd';
import { CheckOutlined, CopyOutlined, ReloadOutlined, RedoOutlined } from '@ant-design/icons';
import type { ReviewThread } from '../../shared/types';
import { CommentComposer } from './CommentComposer';
import styles from '../styles.module.less';

type Props = {
  thread: ReviewThread;
  onFocus: (threadId: string) => void;
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

export function InlineThreadCard({ thread, onFocus, onPatch, onReply, onCopy }: Props) {
  const [isReplying, setIsReplying] = React.useState(false);
  const isResolved = thread.status === 'resolved';

  return (
    <div className={isResolved ? `${styles.inlineThread} ${styles.inlineThreadResolved}` : styles.inlineThread} onClick={() => onFocus(thread.id)}>
      <div className={styles.inlineThreadHeader}>
        <Typography.Text className={styles.inlineThreadAuthor} strong>
          You
        </Typography.Text>
        {isResolved ? <Tag className={`${styles.threadTag} ${styles.threadTagResolved}`}>resolved</Tag> : null}
      </div>

      {thread.comments.map((comment, index) => (
        <div className={index === 0 ? styles.inlineThreadComment : styles.inlineThreadReply} key={comment.id}>
          {index > 0 ? (
            <Typography.Text className={styles.threadReplyLabel}>
              Reply {index} ({comment.author === 'agent' ? 'Agent' : 'User'})
            </Typography.Text>
          ) : null}
          <Typography.Paragraph className={styles.inlineThreadBody}>{comment.body}</Typography.Paragraph>
        </div>
      ))}

      {isReplying ? (
        <div className={styles.inlineThreadComposer}>
          <CommentComposer
            placeholder="继续评论..."
            submitLabel="回复"
            onCancel={() => setIsReplying(false)}
            onSubmit={async (body) => {
              await onReply(thread.id, body);
              setIsReplying(false);
            }}
          />
        </div>
      ) : null}

      <div className={styles.inlineThreadActions}>
        {!isResolved ? (
          <>
            <Button className={styles.threadActionBtn} icon={<RedoOutlined />} onClick={() => setIsReplying(true)}>
              要求再改
            </Button>
            <Button className={styles.threadActionBtn} icon={<CopyOutlined />} onClick={() => void onCopy({ type: 'thread', threadId: thread.id })}>
              复制
            </Button>
          </>
        ) : null}
        <Button
          className={styles.threadActionBtn}
          icon={isResolved ? <ReloadOutlined /> : <CheckOutlined />}
          onClick={() => void onPatch(thread.id, isResolved ? 'unresolved' : 'resolved')}
        >
          {isResolved ? '重新打开' : '确认完成'}
        </Button>
      </div>
    </div>
  );
}
