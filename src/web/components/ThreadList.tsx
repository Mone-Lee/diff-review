/**
 * 评论线程列表：展示每条线程及其下的多条评论，并提供复制与状态切换操作。
 */
import React from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Button, Card, Dropdown, Empty, Modal, Segmented, Space, Tag, Typography } from 'antd';
import type { ReviewThread } from '../../shared/types';
import { COMMENT_STATUS_TEXT_MAP } from '../../shared/types';
import { getThreadStatus } from '../../shared/thread-utils';
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

type ThreadFilter = 'all' | 'pending' | 'resolved';

type BatchAction = 'delete-resolved' | 'delete-submit' | 'delete-all';

const GROUP_STATUS_ORDER: Record<ReviewThread['status'], number> = {
  submit: 0,
  replied: 1,
  resolved: 2
};

export function ThreadList({ threads, focusedThreadId, onPatch, onDeleteThread, onReply, onPatchComment, onDeleteComment, onCopy }: Props) {
  const [filter, setFilter] = React.useState<ThreadFilter>('all');
  const groupRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const groups = React.useMemo(() => threads.map((thread) => ({ key: thread.id, thread })), [threads]);
  const visibleGroups = React.useMemo(() => {
    const filtered = groups.filter((group) => {
      const status = getThreadStatus(group.thread);
      if (filter === 'resolved') return status === 'resolved';
      if (filter === 'pending') return status !== 'resolved';
      return true;
    });
    return filtered.sort((left, right) => {
      const leftStatus = getThreadStatus(left.thread);
      const rightStatus = getThreadStatus(right.thread);
      return GROUP_STATUS_ORDER[leftStatus] - GROUP_STATUS_ORDER[rightStatus];
    });
  }, [filter, groups]);

  const batchTargets = React.useMemo(() => {
    const resolved = threads.filter((thread) => getThreadStatus(thread) === 'resolved');
    const submit = threads.filter((thread) => getThreadStatus(thread) === 'submit');
    return { resolved, submit };
  }, [threads]);

  const runBatchDelete = React.useCallback(
    async (action: BatchAction) => {
      let targets: ReviewThread[] = [];
      if (action === 'delete-resolved') targets = batchTargets.resolved;
      if (action === 'delete-submit') targets = batchTargets.submit;
      if (action === 'delete-all') targets = threads;
      for (const thread of targets) {
        await onDeleteThread(thread.id);
      }
    },
    [batchTargets.resolved, batchTargets.submit, onDeleteThread, threads]
  );

  const confirmBatchDelete = React.useCallback(
    (action: BatchAction) => {
      const count = action === 'delete-resolved' ? batchTargets.resolved.length : action === 'delete-submit' ? batchTargets.submit.length : threads.length;
      const title = action === 'delete-resolved' ? `删除全部已解决评论（${count}）？` : action === 'delete-submit' ? `删除全部 submit 评论（${count}）？` : `清空全部评论（${count}）？`;
      const okText = action === 'delete-all' ? '清空' : '删除';
      Modal.confirm({
        title,
        okText,
        cancelText: '取消',
        okButtonProps: action === 'delete-all' ? { danger: true } : undefined,
        onOk: async () => runBatchDelete(action)
      });
    },
    [batchTargets.resolved.length, batchTargets.submit.length, runBatchDelete, threads.length]
  );

  React.useEffect(() => {
    if (!focusedThreadId) return;
    const group = visibleGroups.find((item) => item.thread.id === focusedThreadId);
    if (group) {
      groupRefs.current[group.key]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [focusedThreadId, visibleGroups]);

  return (
    <div>
      <div className={styles.threadListToolbar}>
        <div className={styles.threadFilterWrap}>
          <Segmented<ThreadFilter>
            value={filter}
            onChange={(value) => setFilter(value)}
            options={[
              { label: `全部 (${groups.length})`, value: 'all' },
              { label: `未解决 (${groups.filter((group) => getThreadStatus(group.thread) !== 'resolved').length})`, value: 'pending' },
              { label: `已解决 (${groups.filter((group) => getThreadStatus(group.thread) === 'resolved').length})`, value: 'resolved' }
            ]}
            size="small"
          />
        </div>
        <Dropdown
          menu={{
            items: [
              { key: 'delete-resolved', label: `删除已解决（${batchTargets.resolved.length}）`, disabled: batchTargets.resolved.length === 0 },
              { key: 'delete-submit', label: `删除待提交（${batchTargets.submit.length}）`, disabled: batchTargets.submit.length === 0 },
              { type: 'divider' },
              { key: 'delete-all', label: `清空全部（${threads.length}）`, danger: true, disabled: threads.length === 0 }
            ],
            onClick: ({ key }) => {
              if (key === 'delete-resolved' || key === 'delete-submit' || key === 'delete-all') {
                confirmBatchDelete(key);
              }
            }
          }}
          trigger={['click']}
        >
          <Button size="small" className={styles.threadBatchButton}>
            批量操作 <DownOutlined />
          </Button>
        </Dropdown>
      </div>

      {visibleGroups.length === 0 ? (
        <Empty className={styles.threadEmpty} description="暂无评论，悬停到行右侧或添加文件级评论即可开始。" />
      ) : (
        <div className={styles.threads}>
          {visibleGroups.map((group) => {
            const thread = group.thread;
            const threadStatus = getThreadStatus(thread);
            const isFocused = focusedThreadId === thread.id;

            return (
              <Card
                className={[
                  styles.thread,
                  statusCardClass(threadStatus),
                  isFocused ? (threadStatus === 'resolved' ? `${styles.threadFocused} ${styles.threadFocusedResolved}` : `${styles.threadFocused} ${styles.threadFocusedPending}`) : ''
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
                    {formatAnchor(thread)}
                  </Typography.Text>
                  {
                    threadStatus !== 'replied' ? (
                      <Tag className={`${styles.threadTag} ${statusTagClass(threadStatus)}`}>{COMMENT_STATUS_TEXT_MAP[threadStatus]}</Tag>
                    ) : null
                  }
                </Space>
                <div className={styles.threadListInlineBorderless}>
                  <InlineThreadGroup
                    threads={[thread]}
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
      )}
    </div>
  );
}

function statusTagClass(status: ReviewThread['status']): string {
  if (status === 'submit') return styles.threadTagSubmit;
  if (status === 'replied') return styles.threadTagReplied;
  return styles.threadTagResolved;
}


function statusCardClass(status: ReviewThread['status']): string {
  if (status === 'submit') return styles.submit;
  if (status === 'replied') return styles.replied;
  return styles.resolved;
}