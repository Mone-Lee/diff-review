import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ReviewThread } from '../shared/types';

export type CommentStore = {
  threads: ReviewThread[];
};

export async function readComments(repoRoot: string): Promise<CommentStore> {
  const path = commentsPath(repoRoot);
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CommentStore;
  } catch {
    return { threads: [] };
  }
}

export async function writeComments(repoRoot: string, store: CommentStore): Promise<void> {
  const path = commentsPath(repoRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function commentsPath(repoRoot: string): string {
  return join(repoRoot, '.diff-review', 'comments.json');
}
