/**
 * 虚拟 Markdown 快照工具：把内存中的文档包装成新增文件 diff，供计划审查与独立分享复用。
 */
import { createHash } from 'node:crypto';
import type { DiffFile } from '../shared/types';

export function markdownContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export function createVirtualMarkdownDiffFile(path: string, content: string): DiffFile {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const snapshotHash = createHash('sha256').update(JSON.stringify({ path, content })).digest('hex').slice(0, 16);

  return {
    oldPath: '/dev/null',
    newPath: path,
    path,
    snapshotHash,
    status: 'added',
    additions: lines.length,
    deletions: 0,
    isMarkdown: true,
    hunks: [
      {
        header: `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines: lines.map((line, index) => ({ type: 'add', content: line, newLineNumber: index + 1 }))
      }
    ]
  };
}
