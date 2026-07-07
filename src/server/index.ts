/**
 * Review 服务端入口：负责暴露会话、diff、评论、预览与 prompt 相关 API，并维护运行时 review 状态。
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';
import { parseUnifiedDiff } from '../core/diff-parser';
import { diffHash, getDefaultWorkingBase, getDiff, getRecentCommits, readDiffFileContents, readDiffImageContent, readFileForPreview } from '../core/git';
import { REVIEW_REFRESH_PROTOCOL, isRefreshableReviewMode, type DiffFile, type MarkdownPreview, type PromptScope, type ReviewComment, type ReviewMode, type ReviewSession, type ReviewThread } from '../shared/types';
import { buildMarkdownBlocks } from '../core/markdown-source-map';
import { formatPrompt } from '../core/prompt';
import { readComments, updateComments } from './storage';
import { getOpenThreadStatus, getThreadStatus, isThreadOnFileSnapshot, sameAnchor } from '../shared/thread-utils';
import { FileWatcherService } from './file-watcher-service';

export type ReviewServerState = {
  session: ReviewSession;
  diffFiles: DiffFile[];
  webDist?: string;
};

export async function startServer(state: ReviewServerState, port = 4966): Promise<string> {
  let markdownPreviews = await buildMarkdownPreviewCache(state);
  const fileWatcher = new FileWatcherService(state.session.repoRoot);
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/session', (_req, res) => {
    res.json(state.session);
  });

  app.get('/api/diff', (_req, res) => {
    res.json({ files: state.diffFiles });
  });

  // 提供服务端能力声明，供 CLI 在刷新前做版本兼容探测。
  app.get('/api/capabilities', (_req, res) => {
    res.json({ reviewRefreshProtocol: REVIEW_REFRESH_PROTOCOL });
  });

  app.get('/api/review-state', async (_req, res, next) => {
    try {
      const comments = await readComments(state.session.repoRoot);
      res.json({ session: state.session, files: state.diffFiles, threads: comments.threads });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/compare-options', async (_req, res, next) => {
    try {
      const [defaultBase, recentCommits] = await Promise.all([
        getDefaultWorkingBase(state.session.repoRoot),
        getRecentCommits(state.session.repoRoot, 10)
      ]);
      res.json({ defaultBase, recentCommits });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/review-state', async (req, res, next) => {
    try {
      const nextState = req.body as Pick<ReviewServerState, 'session' | 'diffFiles'>;
      if (!nextState.session || nextState.session.repoRoot !== state.session.repoRoot || !Array.isArray(nextState.diffFiles)) {
        res.status(400).json({ error: 'Review state must target the running repository' });
        return;
      }
      const nextReviewState = {
        session: nextState.session,
        diffFiles: nextState.diffFiles,
        webDist: state.webDist
      } satisfies ReviewServerState;
      markdownPreviews = await buildMarkdownPreviewCache(nextReviewState);
      applyReviewState(state, nextReviewState);
      fileWatcher.clearPendingChanges();
      res.json({ session: state.session, files: state.diffFiles });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/watch', (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    res.write(': connected\n\n');
    fileWatcher.subscribe(res);
  });

  app.post('/api/refresh', async (_req, res, next) => {
    try {
      if (!isRefreshableReviewMode(state.session.mode)) {
        res.status(400).json({ error: '当前对比范围不包含可刷新的工作区或暂存区' });
        return;
      }
      const nextReviewState = await rebuildReviewState(state);
      markdownPreviews = await buildMarkdownPreviewCache(nextReviewState);
      applyReviewState(state, nextReviewState);
      fileWatcher.clearPendingChanges();
      const comments = await readComments(state.session.repoRoot);
      res.json({ session: state.session, files: state.diffFiles, threads: comments.threads });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/compare', async (req, res, next) => {
    try {
      const mode = normalizeReviewMode(req.body?.mode);
      const nextReviewState = await rebuildReviewState(state, mode);
      markdownPreviews = await buildMarkdownPreviewCache(nextReviewState);
      applyReviewState(state, nextReviewState);
      fileWatcher.clearPendingChanges();
      const comments = await readComments(state.session.repoRoot);
      res.json({ session: state.session, files: state.diffFiles, threads: comments.threads });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/markdown-preview', async (req, res, next) => {
    try {
      // path 既可能是新路径，也可能是 rename/delete 场景下的旧路径。
      const filePath = String(req.query.path ?? '');
      const preview = markdownPreviews.get(filePath);
      if (!preview) {
        res.status(404).json({ error: 'Markdown file not found in diff' });
        return;
      }
      res.json(preview);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/diff-file-contents', async (req, res, next) => {
    try {
      const filePath = String(req.query.path ?? '');
      if (!filePath) {
        res.status(400).json({ error: 'File path is required' });
        return;
      }

      const file = state.diffFiles.find((item) => item.path === filePath || item.oldPath === filePath);
      if (!file) {
        res.status(404).json({ error: 'Diff file not found' });
        return;
      }

      const contents = await readDiffFileContents(file, state.session.mode, state.session.repoRoot);
      res.json(contents);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/diff-file-image', async (req, res, next) => {
    try {
      const filePath = String(req.query.path ?? '');
      const side = req.query.side === 'old' ? 'old' : req.query.side === 'new' ? 'new' : null;
      if (!filePath || !side) {
        res.status(400).json({ error: 'File path and side are required' });
        return;
      }

      const file = state.diffFiles.find((item) => item.path === filePath || item.oldPath === filePath);
      if (!file) {
        res.status(404).json({ error: 'Diff file not found' });
        return;
      }

      const contents = await readDiffImageContent(file, state.session.mode, state.session.repoRoot, side);
      if (!contents) {
        res.status(404).json({ error: 'Image not found on requested side' });
        return;
      }

      const targetPath = side === 'old' ? file.oldPath : file.path;
      if (targetPath) {
        res.type(targetPath);
      }
      res.send(contents);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/markdown-asset', (req, res) => {
    const relativePath = String(req.query.path ?? '').trim();
    if (!relativePath) {
      res.status(400).json({ error: 'Asset path is required' });
      return;
    }

    const repoRoot = resolve(state.session.repoRoot);
    const normalizedRelativePath = normalize(relativePath);
    const absolutePath = resolve(repoRoot, normalizedRelativePath);
    const inRepo = absolutePath === repoRoot || absolutePath.startsWith(`${repoRoot}${sep}`);
    if (!inRepo || !existsSync(absolutePath)) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.sendFile(absolutePath);
  });

  app.get('/api/threads', async (_req, res, next) => {
    try {
      res.json(await readComments(state.session.repoRoot));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/threads', async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      const body = req.body as Pick<ReviewThread, 'filePath' | 'anchor'> & { body: string };
      const commentBody = body.body?.trim();
      if (!commentBody) {
        res.status(400).json({ error: 'Comment body is required' });
        return;
      }
      const file = state.diffFiles.find((item) => item.path === body.filePath);
      if (!file) {
        res.status(400).json({ error: 'Comment file is not present in the current diff' });
        return;
      }
      const comment: ReviewComment = {
        id: crypto.randomUUID(),
        body: commentBody,
        author: 'user',
        createdAt: now,
        updatedAt: now
      };
      const thread = await updateComments(state.session.repoRoot, (store) => {
        const existingThread = store.threads.find((item) => item.fileSnapshotHash === file.snapshotHash && sameAnchor(item.anchor, body.anchor));
        if (existingThread) {
          existingThread.comments.push(comment);
          existingThread.status = getOpenThreadStatus(existingThread);
          existingThread.updatedAt = now;
          return { changed: true, result: existingThread };
        }

        const nextThread: ReviewThread = {
          id: crypto.randomUUID(),
          filePath: body.filePath,
          anchor: body.anchor,
          diffHash: state.session.diffHash,
          fileSnapshotHash: file.snapshotHash,
          status: 'submit',
          comments: [comment],
          createdAt: now,
          updatedAt: now
        };
        store.threads.push(nextThread);
        return { changed: true, result: nextThread };
      });
      res.status(201).json(thread);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/threads/:id/comments', async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      const body = req.body as { body?: string; author?: 'user' | 'agent' };
      const commentBody = body.body?.trim();
      if (!commentBody) {
        res.status(400).json({ error: 'Comment body is required' });
        return;
      }

      const comment: ReviewComment = {
        id: crypto.randomUUID(),
        body: commentBody,
        author: body.author === 'agent' ? 'agent' : 'user',
        createdAt: now,
        updatedAt: now
      };
      const commentResult = await updateComments(state.session.repoRoot, (store) => {
        const thread = store.threads.find((item) => item.id === req.params.id);
        if (!thread) {
          throw new Error('THREAD_NOT_FOUND');
        }
        thread.comments.push(comment);
        if (thread.status !== 'resolved') {
          thread.status = getOpenThreadStatus(thread);
        }
        thread.updatedAt = now;
        return { changed: true, result: comment };
      });
      res.status(201).json(commentResult);
    } catch (error) {
      if (error instanceof Error && error.message === 'THREAD_NOT_FOUND') {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      next(error);
    }
  });

  app.patch('/api/threads/:id', async (req, res, next) => {
    try {
      const thread = await updateComments(state.session.repoRoot, (store) => {
        const currentThread = store.threads.find((item) => item.id === req.params.id);
        if (!currentThread) {
          throw new Error('THREAD_NOT_FOUND');
        }
        let changed = false;
        if (req.body.status === 'resolved' || req.body.status === 'replied' || req.body.status === 'submit') {
          currentThread.status = req.body.status === 'resolved' ? 'resolved' : getOpenThreadStatus(currentThread);
          currentThread.updatedAt = new Date().toISOString();
          changed = true;
        }
        return { changed, result: currentThread };
      });
      res.json(thread);
    } catch (error) {
      if (error instanceof Error && error.message === 'THREAD_NOT_FOUND') {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      next(error);
    }
  });

  app.delete('/api/threads/:id', async (req, res, next) => {
    try {
      await updateComments(state.session.repoRoot, (store) => {
        const nextThreads = store.threads.filter((item) => item.id !== req.params.id);
        const changed = nextThreads.length !== store.threads.length;
        store.threads = nextThreads;
        return { changed, result: undefined };
      });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/threads/:id/comments/:commentId', async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      const nextBody = String(req.body?.body ?? '').trim();
      if (!nextBody) {
        res.status(400).json({ error: 'Comment body is required' });
        return;
      }
      const comment = await updateComments(state.session.repoRoot, (store) => {
        const thread = store.threads.find((item) => item.id === req.params.id);
        if (!thread) {
          throw new Error('THREAD_NOT_FOUND');
        }
        if (getThreadStatus(thread) !== 'submit') {
          throw new Error('THREAD_NOT_EDITABLE');
        }
        const currentComment = thread.comments.find((item) => item.id === req.params.commentId);
        if (!currentComment) {
          throw new Error('COMMENT_NOT_FOUND');
        }
        if (currentComment.author === 'agent') {
          throw new Error('AGENT_COMMENT_READ_ONLY');
        }
        currentComment.body = nextBody;
        currentComment.updatedAt = now;
        thread.updatedAt = now;
        return { changed: true, result: currentComment };
      });
      res.json(comment);
    } catch (error) {
      if (error instanceof Error && error.message === 'THREAD_NOT_FOUND') {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      if (error instanceof Error && error.message === 'THREAD_NOT_EDITABLE') {
        res.status(400).json({ error: 'Only submitted comments can be edited' });
        return;
      }
      if (error instanceof Error && error.message === 'COMMENT_NOT_FOUND') {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      if (error instanceof Error && error.message === 'AGENT_COMMENT_READ_ONLY') {
        res.status(400).json({ error: 'Agent comments are read-only' });
        return;
      }
      next(error);
    }
  });

  app.delete('/api/threads/:id/comments/:commentId', async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      await updateComments(state.session.repoRoot, (store) => {
        const thread = store.threads.find((item) => item.id === req.params.id);
        if (!thread) {
          throw new Error('THREAD_NOT_FOUND');
        }
        if (getThreadStatus(thread) !== 'submit') {
          throw new Error('THREAD_NOT_EDITABLE');
        }
        const comment = thread.comments.find((item) => item.id === req.params.commentId);
        if (!comment) {
          throw new Error('COMMENT_NOT_FOUND');
        }
        if (comment.author === 'agent') {
          throw new Error('AGENT_COMMENT_READ_ONLY');
        }
        thread.comments = thread.comments.filter((item) => item.id !== req.params.commentId);
        thread.updatedAt = now;
        store.threads = store.threads.filter((item) => item.id !== thread.id || thread.comments.length > 0);
        return { changed: true, result: undefined };
      });
      res.status(204).end();
    } catch (error) {
      if (error instanceof Error && error.message === 'THREAD_NOT_FOUND') {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      if (error instanceof Error && error.message === 'THREAD_NOT_EDITABLE') {
        res.status(400).json({ error: 'Only submitted comments can be deleted' });
        return;
      }
      if (error instanceof Error && error.message === 'COMMENT_NOT_FOUND') {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      if (error instanceof Error && error.message === 'AGENT_COMMENT_READ_ONLY') {
        res.status(400).json({ error: 'Agent comments are read-only' });
        return;
      }
      next(error);
    }
  });

  app.post('/api/prompt', async (req, res, next) => {
    try {
      const scope = req.body as PromptScope;
      const store = await readComments(state.session.repoRoot);
      // Prompt 只拼接目标范围内的线程文本，交由 AI 继续加工。
      const threads = selectPromptThreads(store.threads, scope, state.diffFiles);
      res.json({ prompt: formatPrompt(threads) });
    } catch (error) {
      next(error);
    }
  });

  const webDist = state.webDist ?? join(process.cwd(), 'dist', 'web');
  if (existsSync(webDist)) {
    // 生产模式使用静态资源托管并回退到 SPA 入口。
    app.use(express.static(webDist));
    app.get(/.*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });

  return listen(app, port, fileWatcher);
}

async function buildMarkdownPreviewCache(state: ReviewServerState): Promise<Map<string, MarkdownPreview>> {
  const previews = new Map<string, MarkdownPreview>();
  await Promise.all(
    state.diffFiles
      .filter((file) => file.isMarkdown)
      .map(async (file) => {
        const { content, deleted } = await readFileForPreview(file, state.session.mode, state.session.repoRoot);
        const preview: MarkdownPreview = {
          filePath: file.path,
          content,
          deleted,
          blocks: buildMarkdownBlocks(content)
        };
        previews.set(file.path, preview);
        previews.set(file.oldPath, preview);
      })
  );
  return previews;
}

function applyReviewState(currentState: ReviewServerState, nextState: Pick<ReviewServerState, 'session' | 'diffFiles'>) {
  currentState.session = nextState.session;
  currentState.diffFiles = nextState.diffFiles;
}

/**
 * 依据当前 session.mode 重新读取仓库 diff，并为前端生成一个新的快照会话。
 */
async function rebuildReviewState(state: ReviewServerState, overrideMode?: ReviewMode): Promise<ReviewServerState> {
  const mode = overrideMode ?? state.session.mode;
  const diff = await getDiff(mode, state.session.repoRoot);
  const diffFiles = parseUnifiedDiff(diff);
  const session: ReviewSession = {
    id: crypto.randomUUID(),
    repoName: state.session.repoName,
    repoRoot: state.session.repoRoot,
    mode,
    diffHash: diffHash(diff),
    createdAt: new Date().toISOString()
  };

  return {
    session,
    diffFiles,
    webDist: state.webDist
  };
}

function normalizeReviewMode(value: unknown): ReviewMode {
  if (!value || typeof value !== 'object') {
    throw new Error('Review mode is required');
  }

  const mode = value as Partial<ReviewMode>;
  if (mode.kind === 'staged') return { kind: 'staged' };
  if (mode.kind === 'working') {
    return typeof mode.base === 'string' && mode.base.trim() ? { kind: 'working', base: mode.base.trim() } : { kind: 'working' };
  }
  if (mode.kind === 'revision') {
    const base = typeof mode.base === 'string' ? mode.base.trim() : '';
    const target = typeof mode.target === 'string' ? mode.target.trim() : '';
    const targetLabel = typeof mode.targetLabel === 'string' ? mode.targetLabel.trim() : '';
    if (!base || !target) {
      throw new Error('Base and target are required');
    }
    return targetLabel ? { kind: 'revision', base, target, targetLabel } : { kind: 'revision', base, target };
  }

  throw new Error('Unsupported review mode');
}

function listen(app: express.Express, port: number, fileWatcher: FileWatcherService): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);

    server.once('close', () => {
      fileWatcher.dispose();
    });

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && port !== 0) {
        listen(app, 0, fileWatcher).then(resolve, reject);
        return;
      }
      reject(error);
    });

    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve(`http://127.0.0.1:${actualPort}`);
    });
  });
}

function selectPromptThreads(threads: ReviewThread[], scope: PromptScope, currentFiles: DiffFile[]): ReviewThread[] {
  const isCurrentSnapshotThread = (thread: ReviewThread) => currentFiles.some((file) => isThreadOnFileSnapshot(thread, file));

  if (scope.type === 'thread') return threads.filter((thread) => thread.id === scope.threadId);
  if (scope.type === 'file-unresolved') {
    return threads.filter(
      (thread) => thread.filePath === scope.filePath && thread.status !== 'resolved' && isCurrentSnapshotThread(thread)
    );
  }
  return threads.filter((thread) => thread.status !== 'resolved' && isCurrentSnapshotThread(thread));
}
