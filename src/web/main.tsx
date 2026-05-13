import React from 'react';
import { createRoot } from 'react-dom/client';
import remarkGfm from 'remark-gfm';
import ReactMarkdown from 'react-markdown';
import type { CommentAnchor, DiffFile, MarkdownPreview, ReviewSession, ReviewThread } from '../shared/types';
import './styles.css';

type CommentStore = { threads: ReviewThread[] };

function App() {
  const [session, setSession] = React.useState<ReviewSession | null>(null);
  const [files, setFiles] = React.useState<DiffFile[]>([]);
  const [threads, setThreads] = React.useState<ReviewThread[]>([]);
  const [selectedPath, setSelectedPath] = React.useState<string>('');
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0];

  React.useEffect(() => {
    void loadInitial();
  }, []);

  async function loadInitial() {
    const [sessionRes, diffRes, threadRes] = await Promise.all([
      fetch('/api/session'),
      fetch('/api/diff'),
      fetch('/api/threads')
    ]);
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
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DR</span>
          <div>
            <h1>Diff Review</h1>
            <p>{session ? modeLabel(session) : 'Loading session'}</p>
          </div>
        </div>

        <button className="copy-all" onClick={() => void copyPrompt({ type: 'all-unresolved' })}>
          Copy unresolved prompt
        </button>

        <nav className="file-list">
          {files.map((file) => (
            <button
              className={file.path === selectedFile?.path ? 'file active' : 'file'}
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

      <section className="review-pane">
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
          <div className="empty-state">No diff found. Your workspace is quiet as a sleeping cat.</div>
        )}
      </section>

      <aside className="thread-rail">
        <h2>Comments</h2>
        <ThreadList threads={threads} onPatch={patchThread} onCopy={copyPrompt} />
      </aside>
    </main>
  );
}

function FileHeader({
  file,
  threads,
  onCreate,
  onCopy
}: {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onCopy: (scope: { type: 'file-unresolved'; filePath: string }) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const fileThreads = threads.filter((thread) => thread.filePath === file.path);
  return (
    <header className="file-header">
      <div>
        <p className="eyebrow">{file.isMarkdown ? 'Markdown preview' : 'Unified diff'}</p>
        <h2>{file.path}</h2>
      </div>
      <div className="header-actions">
        <button onClick={() => void onCopy({ type: 'file-unresolved', filePath: file.path })}>Copy file prompt</button>
        <button onClick={() => setOpen((value) => !value)}>File comment</button>
      </div>
      {open ? (
        <CommentComposer
          placeholder="Leave a file-level review comment..."
          onSubmit={async (body) => {
            await onCreate({ type: 'file', filePath: file.path }, body);
            setOpen(false);
          }}
        />
      ) : null}
      {fileThreads.length > 0 ? <p className="thread-count">{fileThreads.length} comment thread(s) on this file</p> : null}
    </header>
  );
}

function CodeDiffViewer({
  file,
  threads,
  onCreate
}: {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
}) {
  const [activeLine, setActiveLine] = React.useState<string | null>(null);
  return (
    <div className="diff-card">
      {file.hunks.map((hunk) => (
        <div className="hunk" key={hunk.header}>
          <div className="hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, index) => {
            const side = line.type === 'remove' ? 'old' : 'new';
            const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
            const anchorKey = `${side}-${lineNumber}-${index}`;
            const lineThreads = threads.filter(
              (thread) =>
                thread.anchor.type === 'diff-line' &&
                thread.anchor.filePath === file.path &&
                thread.anchor.side === side &&
                thread.anchor.lineNumber === lineNumber
            );
            return (
              <div className={`diff-row ${line.type}`} key={anchorKey}>
                <button className="line-no" onClick={() => lineNumber && setActiveLine(anchorKey)}>
                  {line.oldLineNumber ?? ''}
                </button>
                <button className="line-no" onClick={() => lineNumber && setActiveLine(anchorKey)}>
                  {line.newLineNumber ?? ''}
                </button>
                <pre>{line.content || ' '}</pre>
                {activeLine === anchorKey && lineNumber ? (
                  <CommentPopover
                    onCancel={() => setActiveLine(null)}
                    onSubmit={async (body) => {
                      await onCreate({ type: 'diff-line', filePath: file.path, side, lineNumber }, body);
                      setActiveLine(null);
                    }}
                  />
                ) : null}
                {lineThreads.length > 0 ? <span className="line-badge">{lineThreads.length}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function MarkdownPreviewPanel({
  file,
  threads,
  onCreate
}: {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
}) {
  const [preview, setPreview] = React.useState<MarkdownPreview | null>(null);
  const [activeBlock, setActiveBlock] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPreview(null);
    fetch(`/api/markdown-preview?path=${encodeURIComponent(file.path)}`)
      .then((res) => res.json())
      .then((data: MarkdownPreview) => setPreview(data))
      .catch(() => setPreview(null));
  }, [file.path]);

  if (!preview) return <div className="empty-state">Rendering Markdown preview...</div>;

  return (
    <div className="markdown-shell">
      {preview.deleted ? <div className="deleted-banner">Deleted file preview</div> : null}
      {preview.blocks.map((block) => {
        const blockThreads = threads.filter(
          (thread) =>
            thread.anchor.type === 'markdown-line' &&
            thread.anchor.filePath === file.path &&
            thread.anchor.lineNumber >= block.startLine &&
            thread.anchor.lineNumber <= block.endLine
        );
        return (
          <section className="md-block" key={block.id}>
            <button className="md-line" onClick={() => setActiveBlock(block.id)}>
              L{block.startLine}
            </button>
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
            </div>
            {blockThreads.length > 0 ? <span className="line-badge md">{blockThreads.length}</span> : null}
            {activeBlock === block.id ? (
              <CommentPopover
                onCancel={() => setActiveBlock(null)}
                onSubmit={async (body) => {
                  await onCreate({ type: 'markdown-line', filePath: file.path, lineNumber: block.startLine, blockId: block.id }, body);
                  setActiveBlock(null);
                }}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function CommentComposer({
  placeholder,
  onSubmit
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [body, setBody] = React.useState('');
  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!body.trim()) return;
        void onSubmit(body.trim()).then(() => setBody(''));
      }}
    >
      <textarea placeholder={placeholder} value={body} onChange={(event) => setBody(event.target.value)} />
      <button type="submit">Add comment</button>
    </form>
  );
}

function CommentPopover({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: (body: string) => Promise<void> }) {
  return (
    <div className="popover">
      <CommentComposer placeholder="Add a line comment..." onSubmit={onSubmit} />
      <button className="ghost" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function ThreadList({
  threads,
  onPatch,
  onCopy
}: {
  threads: ReviewThread[];
  onPatch: (id: string, status: ReviewThread['status']) => Promise<void>;
  onCopy: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
}) {
  if (threads.length === 0) {
    return <p className="muted">No comments yet. Click a line number or add a file comment to start.</p>;
  }
  return (
    <div className="threads">
      {threads.map((thread) => (
        <article className={thread.status === 'resolved' ? 'thread resolved' : 'thread'} key={thread.id}>
          <strong>{formatAnchor(thread)}</strong>
          {thread.comments.map((comment) => (
            <p key={comment.id}>{comment.body}</p>
          ))}
          <div className="thread-actions">
            <button onClick={() => void onCopy({ type: 'thread', threadId: thread.id })}>Copy</button>
            <button onClick={() => void onPatch(thread.id, thread.status === 'resolved' ? 'unresolved' : 'resolved')}>
              {thread.status === 'resolved' ? 'Reopen' : 'Resolve'}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function modeLabel(session: ReviewSession): string {
  if (session.mode.kind === 'revision') return `${session.mode.base}..${session.mode.target}`;
  return session.mode.kind;
}

function formatAnchor(thread: ReviewThread): string {
  if (thread.anchor.type === 'file') return thread.filePath;
  return `${thread.filePath}:${thread.anchor.lineNumber}`;
}

createRoot(document.getElementById('root')!).render(<App />);
