import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ReviewThread } from '../shared/types';

export type CommentStore = {
  threads: ReviewThread[];
};

export async function readComments(repoRoot: string): Promise<CommentStore> {
  const path = commentsPath(repoRoot);
  try {
    return normalizeStore(JSON.parse(await readFile(path, 'utf8')) as CommentStore);
  } catch {
    return readLegacyComments(repoRoot);
  }
}

export async function writeComments(repoRoot: string, store: CommentStore): Promise<void> {
  const path = commentsPath(repoRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function commentsPath(repoRoot: string): string {
  const repoName = basename(repoRoot) || 'repo';
  const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
  return join(commentLogsDir(), `${repoName}-${repoHash}.comments.json`);
}

function commentLogsDir(): string {
  if (platform() === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'diff-review', 'logs');
  }
  return join(homedir(), '.local', 'diff-review', 'logs');
}

async function readLegacyComments(repoRoot: string): Promise<CommentStore> {
  try {
    return normalizeStore(JSON.parse(await readFile(join(repoRoot, '.diff-review', 'comments.json'), 'utf8')) as CommentStore);
  } catch {
    return { threads: [] };
  }
}

function normalizeStore(store: CommentStore): CommentStore {
  return {
    threads: store.threads.map((thread) => {
      const status = (thread as { status?: string }).status;
      return {
        ...thread,
        status: status === 'resolved' ? 'resolved' : getOpenThreadStatus(thread)
      };
    })
  };
}

function getOpenThreadStatus(thread: ReviewThread): ReviewThread['status'] {
  return thread.comments.some((comment) => comment.author === 'agent') ? 'replied' : 'submit';
}
