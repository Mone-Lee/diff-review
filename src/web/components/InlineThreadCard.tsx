/**
 * Diff/Markdown 内容区内嵌评论卡：把已有评论直接展示在对应行下方。
 */
import React from 'react';
import { Button, Input, Popconfirm, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, RedoOutlined } from '@ant-design/icons';
import type { ReviewThread } from '../../shared/types';
import { CommentComposer } from './CommentComposer';
import styles from '../styles.module.less';

type Props = {
  thread: ReviewThread;
  onFocus: (threadId: string) => void;
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

export function InlineThreadCard({ thread, onFocus, onPatch, onDeleteThread, onReply, onPatchComment, onDeleteComment, onCopy }: Props) {
  const [isReplying, setIsReplying] = React.useState(false);
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null);
  const [editingBody, setEditingBody] = React.useState('');
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
          <div className={styles.commentRow}>
            <div className={styles.commentContent}>
              {editingCommentId === comment.id ? (
                <div className={styles.inlineThreadEdit}>
                  <Input.TextArea
                    value={editingBody}
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => setEditingBody(event.target.value)}
                  />
                  <div className={styles.inlineThreadEditActions}>
                    <Button
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditingCommentId(null);
                        setEditingBody('');
                      }}
                    >
                      取消
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      onClick={async (event) => {
                        event.stopPropagation();
                        await onPatchComment(thread.id, comment.id, editingBody);
                        setEditingCommentId(null);
                        setEditingBody('');
                      }}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              ) : (
                <Typography.Paragraph className={styles.inlineThreadBody}>{comment.body}</Typography.Paragraph>
              )}
            </div>
            {!isResolved && editingCommentId !== comment.id ? (
              <div className={styles.inlineThreadCommentActions}>
                <Button
                  className={styles.threadIconBtn}
                  type="text"
                  icon={<EditOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingCommentId(comment.id);
                    setEditingBody(comment.body);
                  }}
                />
                {index > 0 ? (
                  <Popconfirm
                    title="删除这条评论？"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={async (event) => {
                      event?.stopPropagation();
                      await onDeleteComment(thread.id, comment.id);
                    }}
                  >
                    <Button className={styles.threadIconBtn} type="text" danger icon={<DeleteOutlined />} onClick={(event) => event.stopPropagation()} />
                  </Popconfirm>
                ) : null}
              </div>
            ) : null}
          </div>
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
          <Tooltip title="要求再改">
            <Button className={styles.threadActionBtn} icon={<RedoOutlined />} onClick={() => setIsReplying(true)}>
            </Button>
          </Tooltip>
            <Button type='primary' className={styles.threadActionBtn} icon={<CopyOutlined />} onClick={() => void onCopy({ type: 'thread', threadId: thread.id })}>
            </Button>
          </>
        ) : null}
        <Popconfirm title="删除整个评论线程？" okText="删除" cancelText="取消" onConfirm={() => onDeleteThread(thread.id)}>
          <Button className={styles.threadActionBtn} icon={<DeleteOutlined />} danger onClick={(event) => event.stopPropagation()}>
          </Button>
        </Popconfirm>
        <Tooltip title={isResolved ? '重新打开' : '确认完成'}>
          <Button
            className={styles.threadActionBtn}
            icon={isResolved ? <ReloadOutlined /> : <CheckOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              void onPatch(thread.id, isResolved ? 'unresolved' : 'resolved');
            }}
          >
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
