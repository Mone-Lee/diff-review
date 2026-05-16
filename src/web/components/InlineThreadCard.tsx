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

type GroupProps = Omit<Props, 'thread'> & {
  threads: ReviewThread[];
  showStatusTag?: boolean;
};

export function InlineThreadCard(props: Props) {
  return <InlineThreadGroup {...props} threads={[props.thread]} />;
}

export function InlineThreadGroup({ threads, onFocus, onPatch, onDeleteThread, onReply, onPatchComment, onDeleteComment, onCopy, showStatusTag = true }: GroupProps) {
  const [replyingThreadId, setReplyingThreadId] = React.useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null);
  const [editingBody, setEditingBody] = React.useState('');
  const isResolved = threads.every((thread) => getThreadStatus(thread) === 'resolved');
  const firstThread = threads[0];
  const groupStatus = getGroupStatus(threads);
  const actionThread = getActionThread(threads);
  const actionThreadStatus = actionThread ? getThreadStatus(actionThread) : groupStatus;
  const actionThreadResolved = actionThreadStatus === 'resolved';
  const actionThreadLastComment = actionThread?.comments.at(-1);
  const canCopy = canCopyThread(actionThreadStatus, actionThreadLastComment?.author);
  if (!firstThread) return null;

  return (
    <div className={`${styles.inlineThread} ${inlineThreadStatusClass(groupStatus)}`} onClick={() => onFocus(firstThread.id)}>
      <div className={styles.inlineThreadHeader}>
        {showStatusTag && isResolved ? <Tag className={`${styles.threadTag} ${styles.threadTagResolved}`}>resolved</Tag> : null}
      </div>

      {threads.map((thread, threadIndex) => {
        const threadStatus = getThreadStatus(thread);
        const firstComment = thread.comments[0];
        const isAgentThread = firstComment?.author === 'agent';
        return (
          <div
            className={
              isAgentThread
                ? styles.inlineThreadSection
                : threadIndex === 0
                  ? styles.inlineThreadSection
                  : `${styles.inlineThreadSection} ${styles.inlineThreadSectionUser}`
            }
            key={thread.id}
            onClick={(event) => {
              event.stopPropagation();
              onFocus(thread.id);
            }}
          >
            {thread.comments.map((comment) => {
              const isAgentComment = comment.author === 'agent';
              const canEditComment = groupStatus === 'submit' && threadStatus === 'submit' && !isAgentComment;
              return (
                <div className={`${styles.inlineThreadCommentItem} ${isAgentComment ? styles.inlineThreadCommentItemAgent : ''}`} key={comment.id}>
                  <div className={styles.commentRow}>
                    <div className={styles.commentContent}>
                      <Typography.Text className={isAgentComment ? styles.inlineThreadAgentLabel : styles.threadCommentAuthor} strong>
                        {isAgentComment ? 'Agent' : 'User'}
                      </Typography.Text>
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
                    {canEditComment && editingCommentId !== comment.id ? (
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
                        {/* <Popconfirm
                          title="删除这条评论？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={async (event) => {
                            event?.stopPropagation();
                            await onDeleteComment(thread.id, comment.id);
                          }}
                        >
                          <Button className={styles.threadIconBtn} type="text" danger icon={<DeleteOutlined />} onClick={(event) => event.stopPropagation()} />
                        </Popconfirm> */}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {actionThread && replyingThreadId === actionThread.id ? (
        <div className={styles.inlineThreadComposer}>
          <CommentComposer
            placeholder="继续评论..."
            submitLabel="回复"
            onCancel={() => {
              setReplyingThreadId(null);
            }}
            onSubmit={async (body) => {
              await onReply(actionThread.id, body);
              setReplyingThreadId(null);
            }}
          />
        </div>
      ) : null}

      {actionThread ? (
        <div className={styles.inlineThreadActions}>
          {canCopy ? (
            <Button
              type="primary"
              className={styles.threadActionBtn}
              icon={<CopyOutlined />}
              onClick={(event) => {
                event.stopPropagation();
                void onCopy({ type: 'thread', threadId: actionThread.id });
              }}
            >
              复制
            </Button>
          ) : null}
          {actionThreadStatus === 'replied' ? (
            <Tooltip title="要求再改">
              <Button
                className={styles.threadActionBtn}
                icon={<RedoOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  setReplyingThreadId(actionThread.id);
                }}
              >
                要求再改
              </Button>
            </Tooltip>
          ) : null}
          {
            actionThreadStatus !== 'replied' ? (
              <Popconfirm
                title="删除这组评论？"
                okText="删除"
                cancelText="取消"
                onConfirm={async () => {
                  for (const thread of threads) {
                    await onDeleteThread(thread.id);
                  }
                }}
              >
                <Button className={styles.threadActionBtn} icon={<DeleteOutlined />} danger onClick={(event) => event.stopPropagation()}>
                  删除
                </Button>
              </Popconfirm>
            ) : null
          }
        
          {actionThreadResolved ? (
            <Tooltip title="重新打开">
              <Button
                className={styles.threadActionBtn}
                icon={<ReloadOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  void onPatch(actionThread.id, 'submit');
                }}
              >
                重新打开
              </Button>
            </Tooltip>
          ) : null}
          {actionThreadStatus === 'replied' ? (
            <Tooltip title="确认完成">
              <Button
                className={styles.threadActionBtn}
                icon={<CheckOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  void onPatch(actionThread.id, 'resolved');
                }}
              >
                确认完成
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getGroupStatus(threads: ReviewThread[]): ReviewThread['status'] {
  if (threads.every((thread) => getThreadStatus(thread) === 'resolved')) return 'resolved';
  if (threads.some((thread) => getThreadStatus(thread) === 'replied')) return 'replied';
  return 'submit';
}

function inlineThreadStatusClass(status: ReviewThread['status']): string {
  if (status === 'submit') return styles.inlineThreadSubmit;
  if (status === 'replied') return styles.inlineThreadReplied;
  return styles.inlineThreadResolved;
}

function getThreadStatus(thread: ReviewThread): ReviewThread['status'] {
  if (thread.status === 'resolved') return 'resolved';
  return getOpenThreadStatus(thread);
}

function getOpenThreadStatus(thread: ReviewThread): ReviewThread['status'] {
  return thread.comments.some((comment) => comment.author === 'agent') ? 'replied' : 'submit';
}

function getActionThread(threads: ReviewThread[]): ReviewThread | undefined {
  return (
    threads.find((thread) => getThreadStatus(thread) === 'replied') ??
    threads.find((thread) => getThreadStatus(thread) === 'submit') ??
    threads[0]
  );
}

function canCopyThread(status: ReviewThread['status'], lastAuthor?: 'user' | 'agent'): boolean {
  if (status === 'submit') return true;
  return status === 'replied' && lastAuthor === 'user';
}
