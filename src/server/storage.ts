/**
 * 评论存储工具：负责评论文件路径计算、读写持久化，以及旧评论数据的兼容迁移与归并规范化。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
    const text = await readFile(path, 'utf8');
    return normalizeStore(parseCommentStore(text));
  } catch (error) {
    // 损坏的主评论文件会尝试从完整 JSON 前缀恢复，并重写为合法 JSON
    if (!isMissingFileError(error)) {
      const recovered = await recoverCommentStore(repoRoot, path, error);
      if (recovered) return recovered;
    }
    return readLegacyComments(repoRoot);
  }
}

// 评论写入改为临时文件 + rename 原子替换，降低并发写入留下脏尾巴的风险
export async function writeComments(repoRoot: string, store: CommentStore): Promise<void> {
  const path = commentsPath(repoRoot);
  const tempPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await rename(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
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
    return normalizeStore(parseCommentStore(await readFile(join(repoRoot, '.diff-review', 'comments.json'), 'utf8')));
  } catch {
    return { threads: [] };
  }
}

async function recoverCommentStore(repoRoot: string, path: string, cause: unknown): Promise<CommentStore | undefined> {
  try {
    const recovered = normalizeStore(parseRecoverableCommentStore(await readFile(path, 'utf8')));
    await writeComments(repoRoot, recovered);
    return recovered;
  } catch {
    console.warn(`Failed to read comment store ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
    return undefined;
  }
}

function parseCommentStore(text: string): CommentStore {
  const parsed = JSON.parse(text) as CommentStore;
  if (!Array.isArray(parsed.threads)) return { threads: [] };
  return parsed;
}

function parseRecoverableCommentStore(text: string): CommentStore {
  const end = findRootJsonObjectEnd(text);
  if (end === -1) throw new Error('Comment store does not contain a complete JSON object');
  return parseCommentStore(text.slice(0, end));
}

function findRootJsonObjectEnd(text: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!started) {
      if (/\s/.test(char)) continue;
      if (char !== '{') return -1;
      started = true;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return -1;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
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
