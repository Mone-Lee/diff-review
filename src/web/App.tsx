/**
 * Web 主界面容器：负责加载会话数据、调度子组件和处理核心交互动作。
 */
import React from 'react';
import { App as AntApp, Button, Card, Layout, List, Segmented, Space, Tag, Typography } from 'antd';
import { CopyOutlined, EyeOutlined, PartitionOutlined, MessageOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, ReviewSession, ReviewThread } from '../shared/types';
import { CodeDiffViewer } from './components/CodeDiffViewer';
import { FileHeader } from './components/FileHeader';
import { MarkdownPreviewPanel } from './components/MarkdownPreviewPanel';
import { ThreadList } from './components/ThreadList';
import { formatFileStatus, modeLabel } from './utils';
import styles from './styles.module.less';

type CommentStore = { threads: ReviewThread[] };
type DiffViewMode = 'inline' | 'split';
const FILE_PATH_MAX_LENGTH = 36;
const FILE_PATH_SUFFIX_LENGTH = 18;

function middleEllipsis(text: string, maxLength: number, suffixLength: number) {
  if (text.length <= maxLength) return text;
  const safeSuffixLength = Math.min(suffixLength, maxLength - 4);
  const prefixLength = maxLength - safeSuffixLength - 3;
  return `${text.slice(0, prefixLength)}...${text.slice(-safeSuffixLength)}`;
}

export default function App() {
  const { message } = AntApp.useApp();
  const [session, setSession] = React.useState<ReviewSession | null>(null);
  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [threads, setThreads] = React.useState<ReviewThread[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string>('');
  const [diffViewMode, setDiffViewMode] = React.useState<DiffViewMode>('split');
  const [focusedThreadId, setFocusedThreadId] = React.useState<string | null>(null);
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0];

  const unresolvedThreadsCount = threads.filter((thread) => thread.status !== 'resolved').length;

  React.useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    // 首次进入页面并行拉取会话、diff 与评论线程，降低加载等待时间。
    const [sessionRes, diffRes, threadRes] = await Promise.all([fetch('/api/session'), fetch('/api/diff'), fetch('/api/threads')]);
    const nextSession = (await sessionRes.json()) as ReviewSession;
    const diff = (await diffRes.json()) as { files: DiffFile[] };
    const store = (await threadRes.json()) as CommentStore;
    setSession(nextSession);
    setFiles(diff.files);
    setThreads(store.threads);
    setSelectedPath(diff.files[0]?.path ?? '');
  }

  async function refreshThreads() {
    const res = await fetch('/api/threads');
    const store = (await res.json()) as CommentStore;
    setThreads(store.threads);
    if (focusedThreadId && !store.threads.some((thread) => thread.id === focusedThreadId)) {
      setFocusedThreadId(null);
    }
  }

  async function createThread(anchor: CommentAnchor, body: string) {
    await fetch('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: anchor.filePath, anchor, body })
    });
    await refreshThreads();
  }

  async function patchThread(id: string, status: ReviewThread['status']) {
    await fetch(`/api/threads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    await refreshThreads();
  }

  async function replyThread(id: string, body: string) {
    await fetch(`/api/threads/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, author: 'user' })
    });
    await refreshThreads();
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
    setFocusedThreadId(threadId);
  }

  React.useEffect(() => {
    setFocusedThreadId(null);
  }, [selectedPath]);

  return (
    <Layout className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>DR</div>
          <div>
            <Typography.Title level={3}>Diff 审查台</Typography.Title>
            <Typography.Text type="secondary">{session ? modeLabel(session) : '正在加载会话'}</Typography.Text>
          </div>
        </div>

        <Card className={styles.sideCard} bordered={false}>
          <Space size={8} wrap>
            <Tag color="blue">{session?.mode.kind === 'revision' ? '混合模式' : '本地模式'}</Tag>
            <Tag color="gold">{files.length} files</Tag>
          </Space>
        </Card>

        <div className={styles.fileRailHeader}>
          <Typography.Text strong>文件列表</Typography.Text>
        </div>
        <List
          className={styles.fileList}
          dataSource={files}
          renderItem={(file) => {
            const isActive = file.path === selectedFile?.path;
             const fileThreads = threads.filter((thread) => thread.filePath === file.path);
            return (
              <List.Item className={isActive ? `${styles.fileItem} ${styles.fileItemActive}` : styles.fileItem} onClick={() => setSelectedPath(file.path)}>
                <div className={styles.fileMeta}>
                  <Tag color={file.status === 'deleted' ? 'error' : file.status === 'added' ? 'green' : 'processing'}>
                    {formatFileStatus(file.status)}
                  </Tag>
                  <Typography.Text strong className={styles.fileName} title={file.path}>
                    {middleEllipsis(file.path, FILE_PATH_MAX_LENGTH, FILE_PATH_SUFFIX_LENGTH)}
                  </Typography.Text>
                </div>
                <Typography.Text className={styles.fileStats} type="secondary">
                  <span className={styles.fileStatAdd}>+{file.additions}</span> / <span className={styles.fileStatDelete}>-{file.deletions}</span>
                </Typography.Text>
                {
                  fileThreads.length > 0 ? (
                    <Tag className={styles.fileThreadCount} icon={<MessageOutlined />}>
                      {fileThreads.length}
                    </Tag>
                  ) : null
                }
              </List.Item>
            );
          }}
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
              <FileHeader file={selectedFile} threads={threads} onCreate={createThread} onCopy={copyPrompt} />
              {selectedFile.isMarkdown ? (
                <MarkdownPreviewPanel
                  file={selectedFile}
                  threads={threads}
                  onCreate={createThread}
                  onLocateThread={locateThread}
                  onPatchThread={patchThread}
                  onReplyThread={replyThread}
                  onCopyThread={copyPrompt}
                />
              ) : (
                 <CodeDiffViewer
                  file={selectedFile}
                  threads={threads}
                  onCreate={createThread}
                  onLocateThread={locateThread}
                  onPatchThread={patchThread}
                  onReplyThread={replyThread}
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
          <Button icon={<CopyOutlined />} type="primary" onClick={() => void copyPrompt({ type: 'all-unresolved' })}>
            批量提交给 Agent
          </Button>
        </div>
        <div className={styles.threadRailBody}>
          <ThreadList threads={threads} focusedThreadId={focusedThreadId} onPatch={patchThread} onReply={replyThread} onCopy={copyPrompt} />
        </div>
      </aside>
    </Layout>
  );
}
