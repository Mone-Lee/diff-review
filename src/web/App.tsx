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
import type { CommentAnchor, DiffFile, ReviewSession, ReviewThread } from '../shared/types';
import { CodeDiffViewer } from './components/DiffViewer';
import { FileList } from './components/FileList';
import { FileHeader } from './components/FileHeader';
import { MarkdownPreviewPanel } from './components/MarkdownPreviewPanel';
import { ThreadList } from './components/ThreadList';
import { isThreadOnFileSnapshot } from '../shared/thread-utils';
import { modeLabel } from './utils';
import styles from './styles.module.less';

type ReviewState = { session: ReviewSession; files: DiffFile[]; threads: ReviewThread[] };
type DiffViewMode = 'inline' | 'split';
type LocateTarget = { threadId: string; anchor: CommentAnchor };
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

export default function App() {
  const { message } = AntApp.useApp();
  const [session, setSession] = React.useState<ReviewSession | null>(null);
  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [threads, setThreads] = React.useState<ReviewThread[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string>('');
  const [diffViewMode, setDiffViewMode] = React.useState<DiffViewMode>('split');
  const [focusedThreadId, setFocusedThreadId] = React.useState<string | null>(null);
  const [locateTarget, setLocateTarget] = React.useState<LocateTarget | null>(null);
  const [expandAllRequest, setExpandAllRequest] = React.useState<ExpandAllRequest | null>(null);
  const [expandedContextByFile, setExpandedContextByFile] = React.useState<Record<string, boolean>>({});
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0];
  const currentSnapshotThreads = React.useMemo(
    () => threads.filter((thread) => files.some((file) => isThreadOnFileSnapshot(thread, file))),
    [files, threads]
  );
  const selectedFileThreads = React.useMemo(
    () => (selectedFile ? currentSnapshotThreads.filter((thread) => isThreadOnFileSnapshot(thread, selectedFile)) : []),
    [currentSnapshotThreads, selectedFile]
  );

  const unresolvedThreadsCount = currentSnapshotThreads.filter((thread) => thread.status !== 'resolved').length;

  React.useEffect(() => {
    void loadInitial();
  }, []);

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
  }, [focusedThreadId, session?.id]);

  async function loadInitial() {
    await refreshReviewState(true);
  }

  async function refreshReviewState(forceSnapshot = false) {
    const res = await fetch('/api/review-state');
    const nextState = (await res.json()) as ReviewState;
    const snapshotChanged = forceSnapshot || session?.id !== nextState.session.id;
    if (snapshotChanged) {
      setSession(nextState.session);
      setFiles(nextState.files);
      setSelectedPath((currentPath) => nextState.files.some((file) => file.path === currentPath) ? currentPath : nextState.files[0]?.path ?? '');
    }
    setThreads((currentThreads) => (areThreadsEqual(currentThreads, nextState.threads) ? currentThreads : nextState.threads));
    if (focusedThreadId && !nextState.threads.some((thread) => thread.id === focusedThreadId)) {
      setFocusedThreadId(null);
    }
  }

  async function createThread(anchor: CommentAnchor, body: string) {
    await fetch('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: anchor.filePath, anchor, body })
    });
    await refreshReviewState();
  }

  async function patchThread(id: string, status: ReviewThread['status']) {
    const res = await fetch(`/api/threads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({ error: '更新评论状态失败' }))) as { error?: string };
      throw new Error(data.error ?? '更新评论状态失败');
    }
    await refreshReviewState();
  }

  async function deleteThread(id: string) {
    await fetch(`/api/threads/${id}`, { method: 'DELETE' });
    await refreshReviewState();
  }

  async function replyThread(id: string, body: string) {
    await fetch(`/api/threads/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, author: 'user' })
    });
    await refreshReviewState();
  }

  async function patchComment(threadId: string, commentId: string, body: string) {
    if (!commentId) {
      throw new Error('Comment id is required');
    }
    const res = await fetch(`/api/threads/${threadId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({ error: '编辑评论失败' }))) as { error?: string };
      throw new Error(data.error ?? '编辑评论失败');
    }
    await refreshReviewState();
  }

  async function copyPrompt(scope: { type: 'thread'; threadId: string } | { type: 'file-unresolved'; filePath: string } | { type: 'all-unresolved' }) {
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope)
    });
    const data = (await res.json()) as { prompt: string };
    await navigator.clipboard.writeText(data.prompt);
    void message.success('提示词已复制到剪贴板');
  }

  function locateThread(threadId: string) {
    const target = threads.find((thread) => thread.id === threadId);
    if (target) {
      const fileExists = files.some((file) => file.path === target.filePath);
      if (fileExists) {
        setSelectedPath(target.filePath);
      }
      setLocateTarget({ threadId, anchor: target.anchor });
    }
    setFocusedThreadId(threadId);
  }

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
    setFocusedThreadId(null);
  }, [selectedPath]);

  return (
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
          files={files}
          threads={currentSnapshotThreads}
          selectedPath={selectedFile?.path ?? ''}
          onSelectFile={setSelectedPath}
        />
      </aside>

      <section className={styles.reviewPane}>
        {selectedFile ? (
          <>
          {!selectedFile.isMarkdown ? (
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
            ) : null}

            <div className={styles.reviewSurface}>
              <FileHeader
                file={selectedFile}
                threads={selectedFileThreads}
                showToggleAllLines={!selectedFile.isMarkdown && !isImageFilePath(selectedFile.path)}
                hasExpandedContext={selectedFile ? (expandedContextByFile[selectedFile.path] ?? false) : false}
                onCreate={createThread}
                onCopy={copyPrompt}
                onToggleAllLines={toggleAllLines}
                onLocateThread={locateThread}
                onPatchThread={patchThread}
                onDeleteThread={deleteThread}
                onReplyThread={replyThread}
                onPatchComment={patchComment}
                onCopyThread={copyPrompt}
              />
              {selectedFile.isMarkdown ? (
                <MarkdownPreviewPanel
                  key={session?.id}
                  file={selectedFile}
                  threads={selectedFileThreads}
                  locateTarget={locateTarget}
                  onCreate={createThread}
                  onLocateThread={locateThread}
                  onPatchThread={patchThread}
                  onDeleteThread={deleteThread}
                  onReplyThread={replyThread}
                  onPatchComment={patchComment}
                  onCopyThread={copyPrompt}
                />
              ) : (
                 <CodeDiffViewer
                  key={session?.id}
                  file={selectedFile}
                  threads={selectedFileThreads}
                  locateTarget={locateTarget}
                  expandAllRequest={expandAllRequest}
                  onExpandedContextChange={handleExpandedContextChange}
                  onCreate={createThread}
                  onLocateThread={locateThread}
                  onPatchThread={patchThread}
                  onDeleteThread={deleteThread}
                  onReplyThread={replyThread}
                  onPatchComment={patchComment}
                  onCopyThread={copyPrompt}
                  viewMode={diffViewMode}
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
          <Button disabled={unresolvedThreadsCount === 0} icon={<CopyOutlined />} type="primary" onClick={() => void copyPrompt({ type: 'all-unresolved' })}>
            批量提交给 Agent
          </Button>
        </div>
        <div className={styles.threadRailBody}>
          <ThreadList
            threads={threads}
            currentFiles={files}
            currentFilePath={selectedFile?.path ?? ''}
            focusedThreadId={focusedThreadId}
            onLocateThread={locateThread}
            onPatch={patchThread}
            onDeleteThread={deleteThread}
            onReply={replyThread}
            onPatchComment={patchComment}
            onCopy={copyPrompt}
          />
        </div>
      </aside>
    </Layout>
  );
}
