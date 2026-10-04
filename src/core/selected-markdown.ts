/**
 * 选中 Markdown 补全：当 Agent 指定的 Markdown 没有 Git diff 时，仍将其作为零变更文件纳入审查，供预览和评论使用。
 */
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { readFileForPreview } from './git';
import type { DiffFile, ReviewMode } from '../shared/types';

/**
 * 保留已在 diff 中的文件，并为未变更的选中 Markdown 创建零变更快照。
 * 非 Markdown 保持不加入，因而继续使用整体的“没有更改”状态。
 */
export async function includeSelectedMarkdownFiles(
  diffFiles: DiffFile[],
  selectedFiles: string[] | undefined,
  mode: ReviewMode,
  repoRoot: string
): Promise<DiffFile[]> {
  if (!selectedFiles?.length) return diffFiles;

  const existingPaths = new Set(diffFiles.flatMap((file) => [file.path, file.oldPath, file.newPath]));
  const unchangedMarkdownFiles = await Promise.all(
    selectedFiles
      .filter((path) => isMarkdownPath(path) && !existingPaths.has(path))
      .map((path) => createUnchangedMarkdownFile(path, mode, repoRoot))
  );

  return [...diffFiles, ...unchangedMarkdownFiles];
}

function isMarkdownPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === '.md' || extension === '.markdown';
}

async function createUnchangedMarkdownFile(path: string, mode: ReviewMode, repoRoot: string): Promise<DiffFile> {
  const file: DiffFile = {
    oldPath: path,
    newPath: path,
    path,
    snapshotHash: '',
    status: 'modified',
    additions: 0,
    deletions: 0,
    isMarkdown: true,
    hunks: []
  };
  const { content } = await readFileForPreview(file, mode, repoRoot);
  return {
    ...file,
    snapshotHash: createHash('sha256').update(JSON.stringify({ path, content })).digest('hex').slice(0, 16)
  };
}
