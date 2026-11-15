/**
 * 选中文档补全：为没有 Git diff 的 Markdown 和 Feature 创建全文审查快照，供预览和逐行评论使用。
 */
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { readFileForPreview } from './git';
import type { DiffFile, ReviewMode } from '../shared/types';

/**
 * 保留已有 diff；显式选中的 Markdown 和 Feature 即使被 Git 忽略，也按当前审查模式读取全文。
 * 其他类型不补全，避免扩大原有代码审查范围。
 */
export async function includeSelectedReviewFiles(
  diffFiles: DiffFile[],
  selectedFiles: string[] | undefined,
  mode: ReviewMode,
  repoRoot: string
): Promise<DiffFile[]> {
  if (!selectedFiles?.length) return diffFiles;

  const existingPaths = new Set(diffFiles.flatMap((file) => [file.path, file.oldPath, file.newPath]));
  const unchangedFiles = await Promise.all(
    selectedFiles
      .filter((path) => (isMarkdownPath(path) || extname(path).toLowerCase() === '.feature') && !existingPaths.has(path))
      .map((path) => createUnchangedReviewFile(path, mode, repoRoot))
  );

  return [...diffFiles, ...unchangedFiles];
}

// 保留原导出，兼容已有的 Markdown 调用方。
export const includeSelectedMarkdownFiles = includeSelectedReviewFiles;

function isMarkdownPath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === '.md' || extension === '.markdown';
}

// Feature 使用全文上下文行而非新增行，保持零增删统计与真实源码行号。
async function createUnchangedReviewFile(path: string, mode: ReviewMode, repoRoot: string): Promise<DiffFile> {
  const file: DiffFile = {
    oldPath: path,
    newPath: path,
    path,
    snapshotHash: '',
    status: 'modified',
    additions: 0,
    deletions: 0,
    isMarkdown: isMarkdownPath(path),
    hunks: []
  };
  const { content } = await readFileForPreview(file, mode, repoRoot);
  if (!file.isMarkdown) {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    file.isContentOnly = true;
    file.hunks = [{
      header: `@@ -1,${lines.length} +1,${lines.length} @@`,
      oldStart: 1,
      oldLines: lines.length,
      newStart: 1,
      newLines: lines.length,
      lines: lines.map((line, index) => ({
        type: 'context', content: line, oldLineNumber: index + 1, newLineNumber: index + 1
      }))
    }];
  }
  return {
    ...file,
    snapshotHash: createHash('sha256').update(JSON.stringify({ path, content })).digest('hex').slice(0, 16)
  };
}
