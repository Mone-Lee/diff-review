/**
 * Web 主界面容器：负责加载会话数据、调度子组件和处理核心交互动作。
 */
import React from 'react';
import { App as AntApp, Button, Card, Layout, Segmented, Space, Tag, Typography } from 'antd';
import {
  CopyOutlined,
  EyeOutlined,
  PartitionOutlined
} from '@ant-design/icons';
import type { DiffFile, ReviewSession, ReviewThread } from '../shared/types';
import { fetchReviewState } from './api/review';
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
import { MarkdownPreviewPanel } from './components/MarkdownPreviewPanel';
import { ThreadList } from './components/ThreadList';
import { isThreadOnFileSnapshot } from '../shared/thread-utils';
import { modeLabel } from './utils';
import styles from './styles.module.less';

type DiffViewMode = 'inline' | 'split';
type MarkdownViewMode = 'preview' | 'diff';
type ExpandAllRequest = { filePath: string; requestId: number };

function isImageFilePath(path: string) {
  return /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(path);
}

function sessionRepoName(session: ReviewSession | null) {
  if (!session) return '正在加载仓库';
  return session.repoName || session.repoRoot.split(/[\\/]/).filter(Boolean).at(-1) || session.repoRoot;
}

function areThreadsEqual(left: ReviewThread[], right: ReviewThread[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 侧边栏展示顺序独立于原始 diff 顺序，统一按文件路径升序排列。
 */
function sortFilesByPath(files: DiffFile[]) {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
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
  const sessionIdRef = React.useRef<string | null>(null);
  const focusedThreadIdRef = React.useRef<string | null>(null);
  const displayFiles = React.useMemo(() => sortFilesByPath(files), [files]);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? displayFiles[0];
  const currentSnapshotThreads = React.useMemo(
    () => threads.filter((thread) => files.some((file) => isThreadOnFileSnapshot(thread, file))),
    [files, threads]
  );
  const selectedFileThreads = React.useMemo(
    () => (selectedFile ? currentSnapshotThreads.filter((thread) => isThreadOnFileSnapshot(thread, selectedFile)) : []),
    [currentSnapshotThreads, selectedFile]
  );
  const unresolvedThreadsCount = currentSnapshotThreads.filter((thread) => thread.status !== 'resolved').length;

  const refreshReviewState = React.useCallback(async (forceSnapshot = false) => {
    const nextState = await fetchReviewState();
    const snapshotChanged = forceSnapshot || sessionIdRef.current !== nextState.session.id;

    if (snapshotChanged) {
      setSession(nextState.session);
      sessionIdRef.current = nextState.session.id;
      setFiles(nextState.files);
      const nextDisplayFiles = sortFilesByPath(nextState.files);
      setSelectedPath((currentPath) => nextState.files.some((file) => file.path === currentPath) ? currentPath : nextDisplayFiles[0]?.path ?? '');
    }

    setThreads((currentThreads) => (areThreadsEqual(currentThreads, nextState.threads) ? currentThreads : nextState.threads));

    if (focusedThreadIdRef.current && !nextState.threads.some((thread) => thread.id === focusedThreadIdRef.current)) {
      focusedThreadIdRef.current = null;
      setFocusedThreadId(null);
    }
  }, []);

  React.useEffect(() => {
    void refreshReviewState(true);
  }, [refreshReviewState]);

  React.useEffect(() => {
    const syncVisibleReviewState = () => {
      if (document.visibilityState === 'visible') {
        void refreshReviewState();
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
    void message.success('提示词已复制到剪贴板');
  }, [message]);

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
            </div>

            <Card className={styles.sideCard}>
              <Space size={8} wrap>
                <Tag color="blue">{session?.mode.kind === 'revision' ? '混合模式' : '本地模式'}</Tag>
                <Tag color="gold">{files.length} files</Tag>
              </Space>
            </Card>

            <FileList
              files={displayFiles}
              threads={currentSnapshotThreads}
              selectedPath={selectedFile?.path ?? ''}
              onSelectFile={setSelectedPath}
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
                    showToggleAllLines={!isImageFilePath(selectedFile.path) && (!selectedFile.isMarkdown || markdownViewMode === 'diff')}
                    hasExpandedContext={selectedFile ? (expandedContextByFile[selectedFile.path] ?? false) : false}
                    onToggleAllLines={toggleAllLines}
                  />
                  {selectedFile.isMarkdown && markdownViewMode === 'preview' ? (
                    <MarkdownPreviewPanel
                      key={session?.id}
                      file={selectedFile}
                      threads={selectedFileThreads}
                      locateTarget={locateTarget}
                    />
                  ) : (
                    <CodeDiffViewer
                      key={session?.id}
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
                <Typography.Text type="secondary">未发现变更，当前工作区很安静。</Typography.Text>
              </Card>
            )}
          </section>

          <aside className={styles.threadRail}>
            <div className={styles.threadRailHeader}>
              <Typography.Title className={styles.threadRailTitle} level={4}>评论 ({unresolvedThreadsCount})</Typography.Title>
              <Button disabled={unresolvedThreadsCount === 0} icon={<CopyOutlined />} type="primary" onClick={() => void reviewActions.copyPrompt({ type: 'all-unresolved' })}>
                批量提交给 Agent
              </Button>
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
