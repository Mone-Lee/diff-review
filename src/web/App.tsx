/**
 * Web 主界面容器：负责加载会话数据、调度子组件和处理核心交互动作。
 */
import React from 'react';
import { App as AntApp, Button, Card, Input, Layout, Modal, Popconfirm, Segmented, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  EyeOutlined,
  ImportOutlined,
  LinkOutlined,
  PartitionOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  RollbackOutlined
} from '@ant-design/icons';
import { isRefreshableReviewMode, type DiffFile, type ReviewMode, type ReviewSession, type ReviewThread } from '../shared/types';
import { buildShareUrl, parseShareUrl, reviewThreadsToShareThreads, type MarkdownSharePayload } from '../shared/share';
import { applyReviewComparison, fetchReviewState, importMarkdownShareFeedback, refreshReviewSnapshot, shutdownReviewRuntime, submitPlanReviewResult, type ReviewState } from './api/review';
import { fetchMarkdownPreview } from './api/content';
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

function planReviewResultMessage(decision: 'approved' | 'changes-requested', isCodexPlanReview: boolean): string {
  if (decision === 'changes-requested') {
    return '评论已退回给 Agent，当前审查链接即将失效。';
  }
  if (isCodexPlanReview) {
    return '计划已通过；受 Codex 当前公开 hook 能力限制，请回到 Codex 点击 “Yes, implement this plan”。当前审查链接即将失效。';
  }
  return '计划已通过，当前审查链接即将失效。';
}

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
  const [planResultSubmitted, setPlanResultSubmitted] = React.useState(false);
  const [shareDialogOpen, setShareDialogOpen] = React.useState(false);
  const [shareLink, setShareLink] = React.useState('');
  const [buildingShareLink, setBuildingShareLink] = React.useState(false);
  const [importDialogOpen, setImportDialogOpen] = React.useState(false);
  const [importLink, setImportLink] = React.useState('');
  const [importingFeedback, setImportingFeedback] = React.useState(false);
  const sessionIdRef = React.useRef<string | null>(null);
  const focusedThreadIdRef = React.useRef<string | null>(null);
  const { clearPendingChanges, hasPendingChanges, lastChangedAt } = useFileWatch();
  const displayFiles = React.useMemo(() => sortFilesByPath(files), [files]);
  const currentViewedStorageKey = React.useMemo(() => (session ? viewedStorageKey(session) : null), [session]);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? displayFiles[0];
  const selectedFileIsImage = selectedFile ? isImageFilePath(selectedFile.path) : false;
  const canRefreshSnapshot = session ? isRefreshableReviewMode(session.mode) : false;
  const isPlanReview = session?.reviewKind === 'plan';
  const isCodexPlanReview = session?.planReviewSource === 'codex';
  const canShareSelectedMarkdown = selectedFile?.isMarkdown;
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
    setPlanResultSubmitted(false);
  }, [session?.id]);

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
      setPlanResultSubmitted(true);
      message.success(
        planReviewResultMessage(decision, isCodexPlanReview)
      );
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : '提交计划审查结果失败';
      message.error(`${nextMessage}；结果尚未提交，若页面仍可访问可重试。`);
    } finally {
      setSubmittingPlanResult(false);
    }
  }, [isCodexPlanReview, message, unresolvedThreadsCount]);

  const handleBuildShareLink = React.useCallback(async () => {
    if (!session?.shareBaseUrl || !session.shareId || !selectedFile) {
      setShareDialogOpen(true);
      setShareLink('');
      return;
    }
    setBuildingShareLink(true);
    try {
      const preview = await fetchMarkdownPreview(selectedFile.path);
      const payload: MarkdownSharePayload = {
        version: 1,
        shareId: session.shareId,
        title: selectedFile.path.split('/').at(-1) ?? selectedFile.path,
        filePath: selectedFile.path,
        markdown: preview.content,
        contentHash: selectedFile.snapshotHash,
        threads: reviewThreadsToShareThreads(selectedFileThreads)
      };
      setShareLink(await buildShareUrl(session.shareBaseUrl, payload));
      setShareDialogOpen(true);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成分享链接失败');
    } finally {
      setBuildingShareLink(false);
    }
  }, [message, selectedFile, selectedFileThreads, session]);

  const handleCopyShareLink = React.useCallback(async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      message.success('分享链接已复制');
    } catch {
      message.error('复制失败，请手动复制');
    }
  }, [message, shareLink]);

  const handleImportFeedback = React.useCallback(async () => {
    setImportingFeedback(true);
    try {
      const payload = await parseShareUrl(importLink.trim());
      const result = await importMarkdownShareFeedback(payload);
      await refreshReviewState();
      setImportDialogOpen(false);
      setImportLink('');
      message.success(result.imported > 0 ? `已导入 ${result.imported} 条评论` : '没有新的评论需要导入');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入反馈失败');
    } finally {
      setImportingFeedback(false);
    }
  }, [importLink, message, refreshReviewState]);

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
                    {canShareSelectedMarkdown ? (
                      <Space>
                        <Button icon={<ImportOutlined />} onClick={() => setImportDialogOpen(true)}>
                          导入反馈链接
                        </Button>
                        <Button
                          icon={<LinkOutlined />}
                          loading={buildingShareLink}
                          type="primary"
                          onClick={() => { handleBuildShareLink().catch(() => undefined); }}
                        >
                          分享
                        </Button>
                      </Space>
                    ) : null}
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
                    disabled={planResultSubmitted}
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
                    disabled={unresolvedThreadsCount === 0 || submittingPlanResult || planResultSubmitted}
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
          <Modal
            className={styles.shareModal}
            open={shareDialogOpen}
            title="分享审查链接"
            footer={(
              <Button onClick={() => setShareDialogOpen(false)}>关闭</Button>
            )}
            onCancel={() => setShareDialogOpen(false)}
          >
            {shareLink ? (
              <>
                <Typography.Paragraph className={styles.shareDialogIntro} type="secondary">
                  将完整审查内容与当前评论一并打包。拿到链接的人可以查看并继续添加反馈。
                </Typography.Paragraph>
                <Typography.Text strong>可分享链接</Typography.Text>
                <div className={styles.shareLinkField}>
                  <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} readOnly value={shareLink} />
                  <Button icon={<CopyOutlined />} type="primary" onClick={() => { handleCopyShareLink().catch(() => undefined); }}>
                    复制
                  </Button>
                </div>
              </>
            ) : (
              <Typography.Paragraph type="secondary">
                尚未配置分享门户。请使用 --share-url，或设置 DIFF_REVIEW_SHARE_URL 后重新启动。
              </Typography.Paragraph>
            )}
          </Modal>
          <Modal
            open={importDialogOpen}
            title="导入审阅者反馈"
            okText="导入"
            cancelText="取消"
            confirmLoading={importingFeedback}
            okButtonProps={{ disabled: !importLink.trim() }}
            onCancel={() => setImportDialogOpen(false)}
            onOk={() => { handleImportFeedback().catch(() => undefined); }}
          >
            <Typography.Paragraph type="secondary">
              粘贴审阅者返回的完整反馈链接。只有与当前 Markdown 快照一致的新评论会被导入。
            </Typography.Paragraph>
            <Input.TextArea
              autoSize={{ minRows: 4, maxRows: 8 }}
              placeholder="https://…/#share=…"
              value={importLink}
              onChange={(event) => setImportLink(event.target.value)}
            />
          </Modal>
        </Layout>
      </ReviewNavigationActionsProvider>
    </ReviewActionsProvider>
  );
}
