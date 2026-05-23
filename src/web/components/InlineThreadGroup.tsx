/**
 * 内嵌评论组：承载同一锚点下的一组评论与回复/状态操作。
 */
import React from 'react';
import { Button, Input, Popconfirm, Tag, Typography } from 'antd';
import { CheckOutlined, CopyOutlined, DeleteOutlined, EditOutlined, ReloadOutlined, RedoOutlined } from '@ant-design/icons';
import type { ReviewThread } from '../../shared/types';
import { COMMENT_STATUS_TEXT_MAP } from '../../shared/types';
import { getMergedThreadStatus, getThreadStatus } from '../../shared/thread-utils';
import { CommentComposer } from './CommentComposer';
import styles from '../styles.module.less';

export type InlineThreadGroupProps = {
  threads: ReviewThread[];
  onFocus: (threadId: string) => void;
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReply: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
  showStatusTag?: boolean;
};

export function InlineThreadGroup({
  threads,
  onFocus,
  onPatch,
  onDeleteThread,
  onReply,
  onPatchComment,
  onCopy,
  showStatusTag = true
}: InlineThreadGroupProps) {
  const [replyingThreadId, setReplyingThreadId] = React.useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = React.useState<string | null>(null);
  const [editingBody, setEditingBody] = React.useState('');
  const firstThread = threads[0];
  const groupStatus = getMergedThreadStatus(threads);
  const actionThread = getActionThread(threads);
  const actionThreadStatus = actionThread ? getThreadStatus(actionThread) : groupStatus;
  const actionThreadResolved = actionThreadStatus === 'resolved';
  const actionThreadLastComment = actionThread?.comments.at(-1);
  const canCopy = canCopyThread(actionThreadStatus, actionThreadLastComment?.author);
  if (!firstThread) return null;

  return (
    <div className={`${styles.inlineThread} ${inlineThreadStatusClass(groupStatus)}`} onClick={() => onFocus(firstThread.id)}>
      <div className={styles.inlineThreadHeader}>
        {showStatusTag && groupStatus !== 'replied' ? (
          <Tag className={`${styles.threadTag} ${statusTagClass(groupStatus)}`}>{COMMENT_STATUS_TEXT_MAP[groupStatus]}</Tag>
        ) : null}
      </div>

      {threads.map((thread) => {
        const threadStatus = getThreadStatus(thread);
        return (
          <div
            className={styles.inlineThreadSection}
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
                      {isAgentComment ? (
                        <Typography.Text className={styles.inlineThreadAgentLabel} strong>
                          Agent
                        </Typography.Text>
                      ) : null}
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
          ) : null}
          {actionThreadStatus !== 'replied' ? (
            <Popconfirm
              title={threads.length > 1 ? '删除这组评论？' : '删除这条评论线程？'}
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
          ) : null}

          {actionThreadResolved ? (
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
          ) : null}
          {actionThreadStatus === 'replied' ? (
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function inlineThreadStatusClass(status: ReviewThread['status']): string {
  if (status === 'submit') return styles.inlineThreadSubmit;
  if (status === 'replied') return styles.inlineThreadReplied;
  return styles.inlineThreadResolved;
}

function statusTagClass(status: ReviewThread['status']): string {
  if (status === 'submit') return styles.threadTagSubmit;
  if (status === 'replied') return styles.threadTagReplied;
  return styles.threadTagResolved;
}

function getActionThread(threads: ReviewThread[]): ReviewThread | undefined {
  return threads.find((thread) => getThreadStatus(thread) === 'replied') ?? threads.find((thread) => getThreadStatus(thread) === 'submit') ?? threads[0];
}

function canCopyThread(status: ReviewThread['status'], lastAuthor?: 'user' | 'agent'): boolean {
  if (status === 'submit') return true;
  return status === 'replied' && lastAuthor === 'user';
}
