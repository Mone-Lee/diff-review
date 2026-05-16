import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DiffFile, MarkdownPreview, PromptScope, ReviewComment, ReviewSession, ReviewThread } from '../shared/types';
import { buildMarkdownBlocks } from '../core/markdown-source-map';
import { formatPrompt } from '../core/prompt';
import { readFileForPreview } from '../core/git';
import { readComments, writeComments } from './storage';

export type ReviewServerState = {
  session: ReviewSession;
  diffFiles: DiffFile[];
};

export async function startServer(state: ReviewServerState, port = 4966): Promise<string> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/session', (_req, res) => {
    res.json(state.session);
  });

  app.get('/api/diff', (_req, res) => {
    res.json({ files: state.diffFiles });
  });

  app.get('/api/markdown-preview', async (req, res, next) => {
    try {
      // path 既可能是新路径，也可能是 rename/delete 场景下的旧路径。
      const filePath = String(req.query.path ?? '');
      const file = state.diffFiles.find((item) => item.path === filePath || item.oldPath === filePath);
      if (!file || !file.isMarkdown) {
        res.status(404).json({ error: 'Markdown file not found in diff' });
        return;
      }
      const { content, deleted } = await readFileForPreview(file, state.session.mode, state.session.repoRoot);
      const preview: MarkdownPreview = {
        filePath: file.path,
        content,
        deleted,
        blocks: buildMarkdownBlocks(content)
      };
      res.json(preview);
    } catch (error) {
      next(error);
    }
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
      const store = await readComments(state.session.repoRoot);
      // 新建线程时默认仅包含一条初始评论，后续回复可在此基础扩展。
      const thread: ReviewThread = {
        id: crypto.randomUUID(),
        filePath: body.filePath,
        anchor: body.anchor,
        status: 'submit',
        comments: [
          {
            id: crypto.randomUUID(),
            body: body.body,
            author: 'user',
            createdAt: now,
            updatedAt: now
          }
        ],
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
      const threads = selectPromptThreads(store.threads, scope);
      res.json({ prompt: formatPrompt(threads) });
    } catch (error) {
      next(error);
    }
  });

  const webDist = join(process.cwd(), 'dist', 'web');
  if (existsSync(webDist)) {
    // 生产模式使用静态资源托管并回退到 SPA 入口。
    app.use(express.static(webDist));
    app.get(/.*/, (_req, res) => res.sendFile(join(webDist, 'index.html')));
  }

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });

  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve(`http://127.0.0.1:${actualPort}`);
    });
  });
}

function selectPromptThreads(threads: ReviewThread[], scope: PromptScope): ReviewThread[] {
  if (scope.type === 'thread') return threads.filter((thread) => thread.id === scope.threadId);
  if (scope.type === 'file-unresolved') {
    return threads.filter((thread) => thread.filePath === scope.filePath && thread.status !== 'resolved');
  }
  return threads.filter((thread) => thread.status !== 'resolved');
}

function getThreadStatus(thread: ReviewThread): ReviewThread['status'] {
  if (thread.status === 'resolved') return 'resolved';
  return getOpenThreadStatus(thread);
}

function getOpenThreadStatus(thread: ReviewThread): ReviewThread['status'] {
  return thread.comments.some((comment) => comment.author === 'agent') ? 'replied' : 'submit';
}
