/**
 * Web 主界面容器：负责加载会话数据、调度子组件和处理核心交互动作。
 */
import React from 'react';
import type { CommentAnchor, DiffFile, ReviewSession, ReviewThread } from '../shared/types';
import { CodeDiffViewer } from './components/CodeDiffViewer';
import { FileHeader } from './components/FileHeader';
import { MarkdownPreviewPanel } from './components/MarkdownPreviewPanel';
import { ThreadList } from './components/ThreadList';
import { modeLabel } from './utils';
import styles from './styles.module.less';

type CommentStore = { threads: ReviewThread[] };

export default function App() {
  const [session, setSession] = React.useState<ReviewSession | null>(null);
  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [threads, setThreads] = React.useState<ReviewThread[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string>('');
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0];

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

  async function copyPrompt(scope: { type: 'thread'; threadId: string } | { type: 'file-unresolved'; filePath: string } | { type: 'all-unresolved' }) {
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope)
    });
    const data = (await res.json()) as { prompt: string };
    await navigator.clipboard.writeText(data.prompt);
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>DR</span>
          <div>
            <h1>Diff 审查</h1>
            <p>{session ? modeLabel(session) : '正在加载会话'}</p>
          </div>
        </div>

        <button className={styles.copyAll} onClick={() => void copyPrompt({ type: 'all-unresolved' })}>
          复制全部未解决提示词
        </button>

        <nav className={styles.fileList}>
          {files.map((file) => (
            <button
              className={file.path === selectedFile?.path ? `${styles.file} ${styles.active}` : styles.file}
              key={file.path}
              onClick={() => setSelectedPath(file.path)}
            >
              <span>{file.path}</span>
              <small>
                +{file.additions} / -{file.deletions}
              </small>
            </button>
          ))}
        </nav>
      </aside>

      <section className={styles.reviewPane}>
        {selectedFile ? (
          <>
            <FileHeader file={selectedFile} threads={threads} onCreate={createThread} onCopy={copyPrompt} />
            {selectedFile.isMarkdown ? (
              <MarkdownPreviewPanel file={selectedFile} threads={threads} onCreate={createThread} />
            ) : (
              <CodeDiffViewer file={selectedFile} threads={threads} onCreate={createThread} />
            )}
          </>
        ) : (
          <div className={styles.emptyState}>未发现变更，当前工作区很安静。</div>
        )}
      </section>

      <aside className={styles.threadRail}>
        <h2>评论</h2>
        <ThreadList threads={threads} onPatch={patchThread} onCopy={copyPrompt} />
      </aside>
    </main>
  );
}
