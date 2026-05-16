/**
 * 评论线程列表：展示线程内容，并提供复制与状态切换操作。
 */
import React from 'react';
import { Button, Card, Empty, Input, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, RedoOutlined } from '@ant-design/icons';
import type { ReviewThread } from '../../shared/types';
import { formatAnchor } from '../utils';
import { CommentComposer } from './CommentComposer';
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

export function ThreadList({ threads, focusedThreadId, onPatch, onDeleteThread, onReply, onPatchComment, onDeleteComment, onCopy }: Props) {
  const threadRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const [expandedComposer, setExpandedComposer] = React.useState<Record<string, boolean>>({});
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null);
  const [editingBody, setEditingBody] = React.useState('');

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
              <div className={styles.commentRow}>
                <div className={styles.commentContent}>
                  {editingCommentId === comment.id ? (
                    <div className={styles.inlineThreadEdit}>
                      <Input.TextArea value={editingBody} autoSize={{ minRows: 3, maxRows: 8 }} onChange={(event) => setEditingBody(event.target.value)} />
                      <div className={styles.inlineThreadEditActions}>
                        <Button
                          size="small"
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditingBody('');
                          }}
                        >
                          取消
                        </Button>
                        <Button
                          size="small"
                          type="primary"
                          onClick={async () => {
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
                    <Typography.Paragraph className={styles.threadBody}>{comment.body}</Typography.Paragraph>
                  )}
                </div>
                {thread.status !== 'resolved' && editingCommentId !== comment.id ? (
                  <div className={styles.inlineThreadCommentActions}>
                    <Button
                      className={styles.threadIconBtn}
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEditingCommentId(comment.id);
                        setEditingBody(comment.body);
                      }}
                    />
                    {index > 0 ? (
                      <Popconfirm
                        title="删除这条评论？"
                        okText="删除"
                        cancelText="取消"
                        onConfirm={async () => {
                          await onDeleteComment(thread.id, comment.id);
                        }}
                      >
                        <Button className={styles.threadIconBtn} type="text" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    ) : null}
                  </div>
                ) : null}
              </div>
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
                  </Button>
                </>
              )
            }
            <Popconfirm title="删除整个评论线程？" okText="删除" cancelText="取消" onConfirm={() => onDeleteThread(thread.id)}>
              <Button className={styles.threadActionBtn} icon={<DeleteOutlined />} danger>
              </Button>
            </Popconfirm>
            <Button
              className={styles.threadActionBtn}
              icon={thread.status === 'resolved' ? <ReloadOutlined /> : <CheckOutlined />}
              onClick={() => void onPatch(thread.id, thread.status === 'resolved' ? 'unresolved' : 'resolved')}
            >
              {thread.status === 'resolved' ? '重新打开' : '完成'}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
