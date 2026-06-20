/**
 * Review 服务端入口：负责暴露会话、diff、评论、预览与 prompt 相关 API，并维护运行时 review 状态。
 */
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, normalize, resolve, sep } from 'node:path';
import { REVIEW_REFRESH_PROTOCOL, type DiffFile, type MarkdownPreview, type PromptScope, type ReviewComment, type ReviewSession, type ReviewThread } from '../shared/types';
import { readDiffFileContents, readFileForPreview } from '../core/git';
import { buildMarkdownBlocks } from '../core/markdown-source-map';
import { formatPrompt } from '../core/prompt';
import { readComments, writeComments } from './storage';
import { getOpenThreadStatus, getThreadStatus, isThreadOnFileSnapshot, sameAnchor } from '../shared/thread-utils';

export type ReviewServerState = {
  session: ReviewSession;
  diffFiles: DiffFile[];
  webDist?: string;
};

export async function startServer(state: ReviewServerState, port = 4966): Promise<string> {
  let markdownPreviews = await buildMarkdownPreviewCache(state);
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

  app.post('/api/review-state', async (req, res, next) => {
    try {
      const nextState = req.body as Pick<ReviewServerState, 'session' | 'diffFiles'>;
      if (!nextState.session || nextState.session.repoRoot !== state.session.repoRoot || !Array.isArray(nextState.diffFiles)) {
        res.status(400).json({ error: 'Review state must target the running repository' });
        return;
      }
      const nextReviewState: ReviewServerState = {
        session: nextState.session,
        diffFiles: nextState.diffFiles,
        webDist: state.webDist
      };
      markdownPreviews = await buildMarkdownPreviewCache(nextReviewState);
      state.session = nextReviewState.session;
      state.diffFiles = nextReviewState.diffFiles;
      res.json({ session: state.session, files: state.diffFiles });
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
      const store = await readComments(state.session.repoRoot);
      const existingThread = store.threads.find((thread) => thread.fileSnapshotHash === file.snapshotHash && sameAnchor(thread.anchor, body.anchor));
      const comment: ReviewComment = {
        id: crypto.randomUUID(),
        body: commentBody,
        author: 'user',
        createdAt: now,
        updatedAt: now
      };
      if (existingThread) {
        existingThread.comments.push(comment);
        existingThread.status = getOpenThreadStatus(existingThread);
        existingThread.updatedAt = now;
        await writeComments(state.session.repoRoot, store);
        res.status(201).json(existingThread);
        return;
      }

      const thread: ReviewThread = {
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
      store.threads.push(thread);
      await writeComments(state.session.repoRoot, store);
      res.status(201).json(thread);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/threads/:id/comments', async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      const store = await readComments(state.session.repoRoot);
      const thread = store.threads.find((item) => item.id === req.params.id);
      if (!thread) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }

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
      thread.comments.push(comment);
      if (thread.status !== 'resolved') {
        thread.status = getOpenThreadStatus(thread);
      }
      thread.updatedAt = now;
      await writeComments(state.session.repoRoot, store);
      res.status(201).json(comment);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/threads/:id', async (req, res, next) => {
    try {
      const store = await readComments(state.session.repoRoot);
      const thread = store.threads.find((item) => item.id === req.params.id);
      if (!thread) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      if (req.body.status === 'resolved' || req.body.status === 'replied' || req.body.status === 'submit') {
        thread.status = req.body.status === 'resolved' ? 'resolved' : getOpenThreadStatus(thread);
        thread.updatedAt = new Date().toISOString();
      }
      await writeComments(state.session.repoRoot, store);
      res.json(thread);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/threads/:id', async (req, res, next) => {
    try {
      const store = await readComments(state.session.repoRoot);
      store.threads = store.threads.filter((item) => item.id !== req.params.id);
      await writeComments(state.session.repoRoot, store);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/threads/:id/comments/:commentId', async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      const store = await readComments(state.session.repoRoot);
      const thread = store.threads.find((item) => item.id === req.params.id);
      if (!thread) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      if (getThreadStatus(thread) !== 'submit') {
        res.status(400).json({ error: 'Only submitted comments can be edited' });
        return;
      }
      const comment = thread.comments.find((item) => item.id === req.params.commentId);
      if (!comment) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      if (comment.author === 'agent') {
        res.status(400).json({ error: 'Agent comments are read-only' });
        return;
      }
      const nextBody = String(req.body?.body ?? '').trim();
      if (!nextBody) {
        res.status(400).json({ error: 'Comment body is required' });
        return;
      }
      comment.body = nextBody;
      comment.updatedAt = now;
      thread.updatedAt = now;
      await writeComments(state.session.repoRoot, store);
      res.json(comment);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/threads/:id/comments/:commentId', async (req, res, next) => {
    try {
      const now = new Date().toISOString();
      const store = await readComments(state.session.repoRoot);
      const thread = store.threads.find((item) => item.id === req.params.id);
      if (!thread) {
        res.status(404).json({ error: 'Thread not found' });
        return;
      }
      if (getThreadStatus(thread) !== 'submit') {
        res.status(400).json({ error: 'Only submitted comments can be deleted' });
        return;
      }
      const comment = thread.comments.find((item) => item.id === req.params.commentId);
      if (!comment) {
        res.status(404).json({ error: 'Comment not found' });
        return;
      }
      if (comment.author === 'agent') {
        res.status(400).json({ error: 'Agent comments are read-only' });
        return;
      }
      thread.comments = thread.comments.filter((item) => item.id !== req.params.commentId);
      thread.updatedAt = now;
      store.threads = store.threads.filter((item) => item.id !== thread.id || thread.comments.length > 0);
      await writeComments(state.session.repoRoot, store);
      res.status(204).end();
    } catch (error) {
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

  return listen(app, port);
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

function listen(app: express.Express, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && port !== 0) {
        listen(app, 0).then(resolve, reject);
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
