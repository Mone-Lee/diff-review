/**
 * 评论存储工具：负责评论文件路径计算、读写持久化，以及旧评论数据的兼容迁移与归并规范化。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { DiffFile, ReviewThread } from '../shared/types';
import { anchorKey, getMergedThreadStatus, getThreadStatus } from '../shared/thread-utils';

export type CommentStore = {
  threads: ReviewThread[];
};

export async function readComments(repoRoot: string): Promise<CommentStore> {
  return readCommentStore(repoRoot);
}

export async function attachLegacyComments(repoRoot: string, diffHash: string, diffFiles: DiffFile[]): Promise<void> {
  const store = await readCommentStore(repoRoot);
  let changed = false;
  for (const thread of store.threads) {
    if (!thread.diffHash) {
      thread.diffHash = diffHash;
      changed = true;
    }
    const file = diffFiles.find((item) => item.path === thread.filePath);
    // 旧数据没有文件快照：同一整体快照可直接迁移；待处理评论仍挂回可见文件，避免升级后无处处理。
    if (!thread.fileSnapshotHash && file && (thread.diffHash === diffHash || getThreadStatus(thread) === 'submit')) {
      thread.fileSnapshotHash = file.snapshotHash;
      changed = true;
    }
  }
  if (changed) await writeComments(repoRoot, store);
}

async function readCommentStore(repoRoot: string): Promise<CommentStore> {
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
  const groups = new Map<string, ReviewThread[]>();
  for (const thread of store.threads) {
    const snapshotKey = thread.fileSnapshotHash ?? (thread.diffHash ? `diff:${thread.diffHash}` : 'legacy');
    const key = `${snapshotKey}:${anchorKey(thread.anchor)}`;
    groups.set(key, [...(groups.get(key) ?? []), thread]);
  }

  return {
    threads: Array.from(groups.values()).map((threads) => {
      const [firstThread, ...restThreads] = threads;
      const merged: ReviewThread = {
        ...firstThread,
        comments: threads.flatMap((thread) => thread.comments),
        status: getMergedThreadStatus(threads),
        updatedAt: latestTimestamp(threads.map((thread) => thread.updatedAt))
      };
      if (restThreads.length === 0) return merged;
      return {
        ...merged,
        createdAt: earliestTimestamp(threads.map((thread) => thread.createdAt))
      };
    })
  };
}

function latestTimestamp(values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), values[0] ?? new Date().toISOString());
}

function earliestTimestamp(values: string[]): string {
  return values.reduce((earliest, value) => (value < earliest ? value : earliest), values[0] ?? new Date().toISOString());
}
