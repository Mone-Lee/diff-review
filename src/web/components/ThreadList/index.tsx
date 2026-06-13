/**
 * 评论线程列表：展示每条线程及其下的多条评论，并提供复制与状态切换操作。
 */
import React from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Button, Card, Dropdown, Empty, Modal, Segmented, Space, Switch, Tag, Typography, Flex } from 'antd';
import type { DiffFile, ReviewThread } from '../../../shared/types';
import { COMMENT_STATUS_TEXT_MAP } from '../../../shared/types';
import { getThreadStatus, isThreadOnFileSnapshot } from '../../../shared/thread-utils';
import { formatAnchor } from '../../utils';
import { InlineThreadGroup } from '../InlineThreadGroup';
import { useReviewActions, useReviewNavigationActions } from '../../contexts/ReviewActionsContext';
import styles from './index.module.less';

type Props = {
  threads: ReviewThread[];
  currentFiles: DiffFile[];
  currentFilePath: string;
  focusedThreadId: string | null;
};

type ThreadFilter = 'all' | 'pending' | 'resolved';
type ThreadScope = 'current-file' | 'all-diff';
type BatchAction = 'delete-resolved' | 'delete-submit' | 'delete-all';

const GROUP_STATUS_ORDER: Record<ReviewThread['status'], number> = {
  submit: 0,
  replied: 1,
  resolved: 2
};

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

export function ThreadList({ threads, currentFiles, currentFilePath, focusedThreadId }: Props) {
  const { deleteThread } = useReviewActions();
  const { locateThread } = useReviewNavigationActions();
  const [filter, setFilter] = React.useState<ThreadFilter>('all');
  const [scope, setScope] = React.useState<ThreadScope>('current-file');
  const [locateFlashThreadId, setLocateFlashThreadId] = React.useState<string | null>(null);
  const groupRefs = React.useRef<Record<string, HTMLDivElement | null>>({});
  const currentFileThreadsCount = React.useMemo(() => {
    if (!currentFilePath) return 0;
    return threads.filter((thread) => thread.filePath === currentFilePath).length;
  }, [currentFilePath, threads]);

  const scopeThreads = React.useMemo(() => {
    if (scope === 'all-diff') return threads;
    if (!currentFilePath) return [];
    return threads.filter((thread) => thread.filePath === currentFilePath);
  }, [currentFilePath, scope, threads]);

  const groups = React.useMemo(() => scopeThreads.map((thread) => ({ key: thread.id, thread })), [scopeThreads]);
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
    const resolved = scopeThreads.filter((thread) => getThreadStatus(thread) === 'resolved');
    const submit = scopeThreads.filter((thread) => getThreadStatus(thread) === 'submit');
    return { resolved, submit };
  }, [scopeThreads]);

  const runBatchDelete = React.useCallback(
    async (action: BatchAction) => {
      let targets: ReviewThread[] = [];
      if (action === 'delete-resolved') targets = batchTargets.resolved;
      if (action === 'delete-submit') targets = batchTargets.submit;
      if (action === 'delete-all') targets = scopeThreads;
      for (const thread of targets) {
        await deleteThread(thread.id);
      }
    },
    [batchTargets.resolved, batchTargets.submit, deleteThread, scopeThreads]
  );

  const confirmBatchDelete = React.useCallback(
    (action: BatchAction) => {
      const count = action === 'delete-resolved' ? batchTargets.resolved.length : action === 'delete-submit' ? batchTargets.submit.length : scopeThreads.length;
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
    [batchTargets.resolved.length, batchTargets.submit.length, runBatchDelete, scopeThreads.length]
  );

  React.useEffect(() => {
    if (currentFilePath) return;
    setScope('all-diff');
  }, [currentFilePath]);

  React.useEffect(() => {
    if (!focusedThreadId) return;
    const group = visibleGroups.find((item) => item.thread.id === focusedThreadId);
    if (group) {
      groupRefs.current[group.key]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [focusedThreadId, visibleGroups]);

  React.useEffect(() => {
    if (!focusedThreadId) return;
    setLocateFlashThreadId(focusedThreadId);
    const timer = window.setTimeout(() => {
      setLocateFlashThreadId((current) => (current === focusedThreadId ? null : current));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [focusedThreadId]);

  return (
    <div>
      <div className={styles.threadScopeBar}>
        <Typography.Text className={styles.threadScopeLabel}>查看范围</Typography.Text>
        <div className={!currentFilePath ? `${styles.threadScopeSwitchRow} ${styles.threadScopeSwitchRowDisabled}` : styles.threadScopeSwitchRow}>
          <button
            type="button"
            className={scope === 'current-file' ? `${styles.threadScopeOption} ${styles.threadScopeOptionActive}` : styles.threadScopeOption}
            onClick={() => setScope('current-file')}
            disabled={!currentFilePath}
          >
            当前文件 ({currentFileThreadsCount})
          </button>
          <Switch
            className={styles.threadScopeSwitch}
            checked={scope === 'all-diff'}
            onChange={(checked) => setScope(checked ? 'all-diff' : 'current-file')}
            disabled={!currentFilePath}
            size="small"
          />
          <button
            type="button"
            className={scope === 'all-diff' ? `${styles.threadScopeOption} ${styles.threadScopeOptionActive}` : styles.threadScopeOption}
            onClick={() => setScope('all-diff')}
            disabled={!currentFilePath}
          >
            全部评论 ({threads.length})
          </button>
        </div>
      </div>

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
              { key: 'delete-all', label: `清空全部（${scopeThreads.length}）`, danger: true, disabled: scopeThreads.length === 0 }
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
            const isHistorical = !currentFiles.some((file) => isThreadOnFileSnapshot(thread, file));

            return (
              <Card
                className={[
                  styles.thread,
                  statusCardClass(threadStatus),
                  isFocused ? styles.threadFocused : '',
                  locateFlashThreadId === thread.id ? styles.threadLocateFlash : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={group.key}
                ref={(node) => {
                  groupRefs.current[group.key] = node;
                }}
              >
                <button type="button" className={styles.threadTopButton} onClick={() => locateThread(thread.id)}>
                  <Space className={styles.threadTop} align="start" size={8}>
                    <Typography.Text className={styles.threadAnchor} strong>
                      {formatAnchor(thread)}
                    </Typography.Text>
                    <Flex gap="small">
                      {
                        threadStatus !== 'replied' ? (
                          <Tag className={`${styles.threadTag} ${statusTagClass(threadStatus)}`}>{COMMENT_STATUS_TEXT_MAP[threadStatus]}</Tag>
                        ) : null
                      }
                      {isHistorical ? <Tag className={styles.threadTag}>历史快照</Tag> : null}
                    </Flex>
                  </Space>
                </button>
                <div>
                  <InlineThreadGroup threads={[thread]} variant="borderless" showStatusTag={false} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
