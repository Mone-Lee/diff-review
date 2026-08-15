/**
 * Web 主界面容器：负责加载会话数据、调度子组件和处理核心交互动作。
 */
import React from 'react';
import { App as AntApp, Button, Card, Layout, Popconfirm, Segmented, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  PartitionOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  RollbackOutlined
} from '@ant-design/icons';
import { isRefreshableReviewMode, type DiffFile, type ReviewMode, type ReviewSession, type ReviewThread } from '../shared/types';
import { applyReviewComparison, fetchReviewState, refreshReviewSnapshot, shutdownReviewRuntime, submitPlanReviewResult, type ReviewState } from './api/review';
import {
  type LocateTarget,
  ReviewActionsProvider,
  ReviewNavigationActionsProvider,
  useReviewActionsValue,
  useReviewNavigationActionsValue
} from './contexts/ReviewActionsContext';
import { CodeDiffViewer } from './components/DiffViewer';
import { FileList } from './components/FileList';
import { FileHeader } from './components/FileHeader';
import { ImageDiffViewer } from './components/ImageDiffViewer';
import { MarkdownPreviewPanel } from './components/MarkdownPreviewPanel';
import { RefreshButton } from './components/RefreshButton';
import { ThreadList } from './components/ThreadList';
import { VersionCompareControl } from './components/VersionCompareControl';
import { isThreadOnFileSnapshot } from '../shared/thread-utils';
import { modeLabel } from './utils';
import {
  areFilesEqual,
  areStringSetsEqual,
  areThreadsEqual,
  isImageFilePath,
  readViewedFilePaths,
  sessionRepoName,
  sortFilesByPath,
  viewedStorageKey,
  writeViewedFilePaths
} from './utils/app-state';
import { useFileWatch } from './hooks/useFileWatch';
import styles from './styles.module.less';

type DiffViewMode = 'inline' | 'split';
type MarkdownViewMode = 'preview' | 'diff';
type ExpandAllRequest = { filePath: string; requestId: number };

export default function App() {
  const { message } = AntApp.useApp();
  const [session, setSession] = React.useState<ReviewSession | null>(null);
  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [threads, setThreads] = React.useState<ReviewThread[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string>('');
  const [diffViewMode, setDiffViewMode] = React.useState<DiffViewMode>('split');
  const [markdownViewMode, setMarkdownViewMode] = React.useState<MarkdownViewMode>('preview');
  const [focusedThreadId, setFocusedThreadId] = React.useState<string | null>(null);
  const [locateTarget, setLocateTarget] = React.useState<LocateTarget | null>(null);
  const [expandAllRequest, setExpandAllRequest] = React.useState<ExpandAllRequest | null>(null);
  const [expandedContextByFile, setExpandedContextByFile] = React.useState<Record<string, boolean>>({});
  const [viewedFilePaths, setViewedFilePaths] = React.useState<Set<string>>(() => new Set());
  const [refreshingSnapshot, setRefreshingSnapshot] = React.useState(false);
  const [applyingComparison, setApplyingComparison] = React.useState(false);
  const [shuttingDownRuntime, setShuttingDownRuntime] = React.useState(false);
  const [submittingPlanResult, setSubmittingPlanResult] = React.useState(false);
  const sessionIdRef = React.useRef<string | null>(null);
  const focusedThreadIdRef = React.useRef<string | null>(null);
  const { clearPendingChanges, hasPendingChanges, lastChangedAt } = useFileWatch();
  const displayFiles = React.useMemo(() => sortFilesByPath(files), [files]);
  const currentViewedStorageKey = React.useMemo(() => (session ? viewedStorageKey(session) : null), [session]);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? displayFiles[0];
  const selectedFileIsImage = selectedFile ? isImageFilePath(selectedFile.path) : false;
  const canRefreshSnapshot = session ? isRefreshableReviewMode(session.mode) : false;
  const isPlanReview = session?.reviewKind === 'plan';
  const currentSnapshotThreads = React.useMemo(
    () => threads.filter((thread) => files.some((file) => isThreadOnFileSnapshot(thread, file))),
    [files, threads]
  );
  const selectedFileThreads = React.useMemo(
    () => (selectedFile ? currentSnapshotThreads.filter((thread) => isThreadOnFileSnapshot(thread, selectedFile)) : []),
    [currentSnapshotThreads, selectedFile]
  );
  const unresolvedThreadsCount = currentSnapshotThreads.filter((thread) => thread.status !== 'resolved').length;

  /**
   * 将服务端返回的 review 状态合并进当前界面，并根据快照是否切换决定是否替换文件列表。
   */
  const applyReviewState = React.useCallback((nextState: ReviewState, forceSnapshot = false) => {
    const nextDisplayFiles = sortFilesByPath(nextState.files);
    const sessionChanged = forceSnapshot || sessionIdRef.current !== nextState.session.id;
    sessionIdRef.current = nextState.session.id;

    setSession((currentSession) => {
      if (
        !forceSnapshot &&
        currentSession &&
        currentSession.id === nextState.session.id &&
        currentSession.diffHash === nextState.session.diffHash &&
        currentSession.createdAt === nextState.session.createdAt
      ) {
        return currentSession;
      }
      return nextState.session;
    });

    setFiles((currentFiles) => (sessionChanged || !areFilesEqual(currentFiles, nextState.files) ? nextState.files : currentFiles));
    setSelectedPath((currentPath) => (nextState.files.some((file) => file.path === currentPath) ? currentPath : nextDisplayFiles[0]?.path ?? ''));

    setThreads((currentThreads) => (areThreadsEqual(currentThreads, nextState.threads) ? currentThreads : nextState.threads));

    if (focusedThreadIdRef.current && !nextState.threads.some((thread) => thread.id === focusedThreadIdRef.current)) {
      focusedThreadIdRef.current = null;
      setFocusedThreadId(null);
    }
  }, []);

  const refreshReviewState = React.useCallback(async (forceSnapshot = false) => {
    const nextState = await fetchReviewState();
    applyReviewState(nextState, forceSnapshot);
  }, [applyReviewState]);

  React.useEffect(() => {
    refreshReviewState(true).catch(() => undefined);
  }, [refreshReviewState]);

  React.useEffect(() => {
    if (!currentViewedStorageKey) {
      setViewedFilePaths(new Set());
      return;
    }

    const nextViewedFilePaths = readViewedFilePaths(currentViewedStorageKey);
    setViewedFilePaths((current) => (areStringSetsEqual(current, nextViewedFilePaths) ? current : nextViewedFilePaths));
  }, [currentViewedStorageKey]);

  /**
   * 当文件列表变化时，会用当前 diff 里的 files 过滤一遍，只保留这次快照里仍然存在的路径，避免旧路径残留
   */
  React.useEffect(() => {
    if (!currentViewedStorageKey) return;

    const validFilePaths = new Set(files.map((file) => file.path));
    const nextViewedFilePaths = new Set([...viewedFilePaths].filter((filePath) => validFilePaths.has(filePath)));

    if (!areStringSetsEqual(viewedFilePaths, nextViewedFilePaths)) {
      setViewedFilePaths(nextViewedFilePaths);
      return;
    }

    writeViewedFilePaths(currentViewedStorageKey, nextViewedFilePaths);
  }, [currentViewedStorageKey, files, viewedFilePaths]);

  React.useEffect(() => {
    const syncVisibleReviewState = () => {
      if (document.visibilityState === 'visible') {
        refreshReviewState().catch(() => undefined);
      }
    };

    const interval = window.setInterval(syncVisibleReviewState, 2500);
    window.addEventListener('focus', syncVisibleReviewState);
    document.addEventListener('visibilitychange', syncVisibleReviewState);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', syncVisibleReviewState);
      document.removeEventListener('visibilitychange', syncVisibleReviewState);
    };
  }, [refreshReviewState]);

  function toggleAllLines(filePath: string) {
    setExpandAllRequest((current) => ({
      filePath,
      requestId: (current?.requestId ?? 0) + 1
    }));
  }

  function handleExpandedContextChange(filePath: string, expanded: boolean) {
    setExpandedContextByFile((current) => {
      if ((current[filePath] ?? false) === expanded) return current;
      return {
        ...current,
        [filePath]: expanded
      };
    });
  }

  function toggleViewedFile(filePath: string) {
    setViewedFilePaths((current) => {
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }

  React.useEffect(() => {
    focusedThreadIdRef.current = null;
    setFocusedThreadId(null);
  }, [selectedPath]);

  React.useEffect(() => {
    if (!locateTarget) return;
    const targetFile = files.find((file) => file.path === locateTarget.anchor.filePath);
    if (!targetFile?.isMarkdown) return;
    if (locateTarget.anchor.type === 'markdown-line') {
      setMarkdownViewMode('preview');
      return;
    }
    if (locateTarget.anchor.type === 'diff-line' && locateTarget.anchor.side === 'old') {
      setMarkdownViewMode('diff');
    }
  }, [files, locateTarget]);

  const handlePromptCopied = React.useCallback(() => {
    message.success('提示词已复制到剪贴板');
  }, [message]);

  /**
   * 只有用户显式点击 Refresh 时才切换到最新 diff，避免编辑过程中的自动跳屏。
   */
  const handleRefreshSnapshot = React.useCallback(async () => {
    if (!canRefreshSnapshot) return;
    setRefreshingSnapshot(true);
    try {
      const nextState = await refreshReviewSnapshot();
      applyReviewState(nextState, true);
      clearPendingChanges();
      message.success('已更新到最新 diff');
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '刷新 diff 失败';
      message.error(nextMessage);
    } finally {
      setRefreshingSnapshot(false);
    }
  }, [applyReviewState, canRefreshSnapshot, clearPendingChanges, message]);

  const handleApplyComparison = React.useCallback(async (mode: ReviewMode) => {
    setApplyingComparison(true);
    try {
      const nextState = await applyReviewComparison(mode);
      applyReviewState(nextState, true);
      clearPendingChanges();
      message.success('已切换对比范围');
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '切换对比失败';
      message.error(nextMessage);
    } finally {
      setApplyingComparison(false);
    }
  }, [applyReviewState, clearPendingChanges, message]);

  const handleShutdownRuntime = React.useCallback(async () => {
    setShuttingDownRuntime(true);
    try {
      await shutdownReviewRuntime();
      message.success('当前 Diff Review 任务已关闭，刷新页面查看效果。');
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '关闭任务失败';
      message.error(nextMessage);
      setShuttingDownRuntime(false);
    }
  }, [message]);

  const handleSubmitPlanResult = React.useCallback(async (decision: 'approved' | 'changes-requested') => {
    if (decision === 'changes-requested' && unresolvedThreadsCount === 0) {
      message.warning('先添加至少一条未解决评论，再退回计划。');
      return;
    }
    setSubmittingPlanResult(true);
    try {
      await submitPlanReviewResult(decision);
      message.success(
        decision === 'approved'
          ? '计划已通过，当前审查链接即将失效。'
          : '评论已退回给 Agent，当前审查链接即将失效。'
      );
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '提交计划审查结果失败';
      message.error(`${nextMessage}；结果尚未提交，若页面仍可访问可重试。`);
    } finally {
      setSubmittingPlanResult(false);
    }
  }, [message, unresolvedThreadsCount]);

  const setFocusedThreadIdWithRef = React.useCallback<React.Dispatch<React.SetStateAction<string | null>>>((value) => {
    setFocusedThreadId((current) => {
      const nextValue = typeof value === 'function' ? value(current) : value;
      focusedThreadIdRef.current = nextValue;
      return nextValue;
    });
  }, []);

  const reviewActions = useReviewActionsValue({
    refreshReviewState,
    onPromptCopied: handlePromptCopied
  });

  const reviewNavigationActions = useReviewNavigationActionsValue({
    files,
    threads,
    setSelectedPath,
    setLocateTarget,
    setFocusedThreadId: setFocusedThreadIdWithRef
  });

  return (
    <ReviewActionsProvider value={reviewActions}>
      <ReviewNavigationActionsProvider value={reviewNavigationActions}>
        <Layout className={styles.shell}>
          <aside className={styles.sidebar}>
            <div className={styles.brand}>
              <div className={styles.brandMark}>DR</div>
              <div className={styles.brandCopy}>
                <Typography.Text className={styles.repoName} title={session?.repoRoot}>
                  {sessionRepoName(session)}
                </Typography.Text>
                <Typography.Text className={styles.productName}>Diff 审查台</Typography.Text>
                <Typography.Text type="secondary">{session ? modeLabel(session) : '正在加载会话'}</Typography.Text>
              </div>

              <Popconfirm
                title="关闭当前 Diff Review 任务？"
                description="确认后这个页面对应的本地服务会停止。"
                okText="关闭"
                cancelText="取消"
                okButtonProps={{ danger: true, loading: shuttingDownRuntime }}
                onConfirm={handleShutdownRuntime}
              >
                <Button
                  aria-label="关闭当前 Diff Review 任务"
                  className={styles.shutdownButton}
                  danger
                  disabled={shuttingDownRuntime}
                  icon={<PoweroffOutlined />}
                  loading={shuttingDownRuntime}
                  size="small"
                  type="text"
                />
              </Popconfirm>

              {canRefreshSnapshot ? (
                <RefreshButton
                  changedAt={lastChangedAt}
                  disabled={refreshingSnapshot}
                  hasPendingChanges={hasPendingChanges}
                  loading={refreshingSnapshot}
                  onRefresh={() => {
                    handleRefreshSnapshot().catch(() => undefined);
                  }}
                  className={styles.refreshButton}
                />
              ) : null}
            </div>

            {!isPlanReview ? (
              <VersionCompareControl
                session={session}
                filesCount={files.length}
                loading={applyingComparison}
                onApply={(mode) => {
                  handleApplyComparison(mode).catch(() => undefined);
                }}
              />
            ) : null}

            <FileList
              files={displayFiles}
              threads={currentSnapshotThreads}
              selectedPath={selectedFile?.path ?? ''}
              viewedFilePaths={viewedFilePaths}
              onSelectFile={setSelectedPath}
              onToggleViewed={toggleViewedFile}
            />
          </aside>

          <section className={styles.reviewPane}>
            {selectedFile ? (
              <>
                {selectedFile.isMarkdown ? (
                  <div className={styles.topToolbar}>
                    <Segmented
                      className={styles.viewModeSwitcher}
                      options={[
                        { label: 'Preview', value: 'preview', icon: <EyeOutlined /> },
                        { label: 'Code diff', value: 'diff', icon: <PartitionOutlined /> }
                      ]}
                      value={markdownViewMode}
                      onChange={(value) => setMarkdownViewMode(value as MarkdownViewMode)}
                    />
                  </div>
                ) : selectedFileIsImage ? (
                  <div className={styles.topToolbar} />
                ) : (
                  <div className={styles.topToolbar}>
                    <Segmented
                      className={styles.viewModeSwitcher}
                      options={[
                        { label: 'Side by side', value: 'split', icon: <PartitionOutlined /> },
                        { label: 'Inline', value: 'inline', icon: <EyeOutlined /> }
                      ]}
                      value={diffViewMode}
                      onChange={(value) => setDiffViewMode(value as DiffViewMode)}
                    />
                  </div>
                )}

                <div className={styles.reviewSurface}>
                  <FileHeader
                    file={selectedFile}
                    threads={selectedFileThreads}
                    isViewed={viewedFilePaths.has(selectedFile.path)}
                    showToggleAllLines={!selectedFileIsImage && (!selectedFile.isMarkdown || markdownViewMode === 'diff')}
                    hasExpandedContext={selectedFile ? (expandedContextByFile[selectedFile.path] ?? false) : false}
                    onToggleAllLines={toggleAllLines}
                    onToggleViewed={toggleViewedFile}
                  />
                  {selectedFile.isMarkdown && markdownViewMode === 'preview' ? (
                    <MarkdownPreviewPanel
                      key={`${session?.id ?? 'session'}:${selectedFile.path}:${selectedFile.snapshotHash}:preview`}
                      file={selectedFile}
                      threads={selectedFileThreads}
                      locateTarget={locateTarget}
                    />
                  ) : selectedFileIsImage ? (
                    <ImageDiffViewer
                      key={`${session?.id ?? 'session'}:${selectedFile.path}:${selectedFile.snapshotHash}:image`}
                      file={selectedFile}
                    />
                  ) : (
                    <CodeDiffViewer
                      key={`${session?.id ?? 'session'}:${selectedFile.path}:${selectedFile.snapshotHash}:${selectedFile.isMarkdown ? 'split' : diffViewMode}`}
                      file={selectedFile}
                      threads={selectedFileThreads}
                      locateTarget={locateTarget}
                      expandAllRequest={expandAllRequest}
                      onExpandedContextChange={handleExpandedContextChange}
                      viewMode={selectedFile.isMarkdown ? 'split' : diffViewMode}
                    />
                  )}
                </div>
              </>
            ) : (
              <Card className={styles.emptyStateCard} bordered={false}>
                <Space direction="vertical" size={12}>
                  <Typography.Text type="secondary">未发现变更，当前工作区很安静。</Typography.Text>
                  {canRefreshSnapshot ? (
                    <Button
                      icon={<ReloadOutlined />}
                      loading={refreshingSnapshot}
                      type="primary"
                      onClick={() => {
                        handleRefreshSnapshot().catch(() => undefined);
                      }}
                    >
                      Refresh
                    </Button>
                  ) : null}
                </Space>
              </Card>
            )}
          </section>

          <aside className={styles.threadRail}>
            <div className={styles.threadRailHeader}>
              <Typography.Title className={styles.threadRailTitle} level={4}>评论 ({unresolvedThreadsCount})</Typography.Title>
              {isPlanReview ? (
                <Space.Compact>
                  <Button
                    icon={<CheckCircleOutlined />}
                    loading={submittingPlanResult}
                    type="primary"
                    onClick={() => {
                      handleSubmitPlanResult('approved').catch(() => undefined);
                    }}
                  >
                    通过计划
                  </Button>
                  <Button
                    disabled={unresolvedThreadsCount === 0 || submittingPlanResult}
                    icon={<RollbackOutlined />}
                    onClick={() => {
                      handleSubmitPlanResult('changes-requested').catch(() => undefined);
                    }}
                  >
                    退回评论
                  </Button>
                </Space.Compact>
              ) : (
                <Button
                  disabled={unresolvedThreadsCount === 0}
                  icon={<CopyOutlined />}
                  type="primary"
                  onClick={() => {
                    reviewActions.copyPrompt({ type: 'all-unresolved' }).catch(() => undefined);
                  }}
                >
                  批量提交给 Agent
                </Button>
              )}
            </div>
            <div className={styles.threadRailBody}>
              <ThreadList
                threads={threads}
                currentFiles={files}
                currentFilePath={selectedFile?.path ?? ''}
                focusedThreadId={focusedThreadId}
              />
            </div>
          </aside>
        </Layout>
      </ReviewNavigationActionsProvider>
    </ReviewActionsProvider>
  );
}
