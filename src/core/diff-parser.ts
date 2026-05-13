import type { DiffFile, DiffHunk, DiffLine } from '../shared/types';

const hunkHeaderPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(input: string): DiffFile[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const files: DiffFile[] = [];
  let currentFile: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith('diff --git ')) {
      const paths = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      currentFile = {
        oldPath: paths?.[1] ?? '',
        newPath: paths?.[2] ?? '',
        path: paths?.[2] ?? '',
        status: 'modified',
        additions: 0,
        deletions: 0,
        isMarkdown: isMarkdownPath(paths?.[2] ?? ''),
        hunks: []
      };
      files.push(currentFile);
      currentHunk = undefined;
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith('rename from ')) {
      currentFile.oldPath = line.slice('rename from '.length);
      currentFile.status = 'renamed';
      continue;
    }

    if (line.startsWith('rename to ')) {
      currentFile.newPath = line.slice('rename to '.length);
      currentFile.path = currentFile.newPath;
      currentFile.isMarkdown = isMarkdownPath(currentFile.path);
      continue;
    }

    if (line.startsWith('new file mode')) {
      currentFile.status = 'added';
      continue;
    }

    if (line.startsWith('deleted file mode')) {
      currentFile.status = 'deleted';
      continue;
    }

    if (line.startsWith('--- ')) {
      currentFile.oldPath = normalizeDiffPath(line.slice(4));
      continue;
    }

    if (line.startsWith('+++ ')) {
      currentFile.newPath = normalizeDiffPath(line.slice(4));
      currentFile.path = currentFile.newPath !== '/dev/null' ? currentFile.newPath : currentFile.oldPath;
      currentFile.isMarkdown = isMarkdownPath(currentFile.path);
      continue;
    }

    const hunkMatch = line.match(hunkHeaderPattern);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      currentHunk = {
        header: line,
        oldStart: oldLine,
        oldLines: Number(hunkMatch[2] ?? 1),
        newStart: newLine,
        newLines: Number(hunkMatch[4] ?? 1),
        lines: []
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), newLineNumber: newLine });
      currentFile.additions += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLineNumber: oldLine });
      currentFile.deletions += 1;
      oldLine += 1;
      continue;
    }

    if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine
      });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if (line === '\\ No newline at end of file') {
      continue;
    }

    const synthetic: DiffLine = { type: 'context', content: line, oldLineNumber: oldLine, newLineNumber: newLine };
    currentHunk.lines.push(synthetic);
  }

  return files.filter((file) => file.path);
}

function normalizeDiffPath(path: string): string {
  if (path === '/dev/null') return path;
  return path.replace(/^[ab]\//, '');
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|mdx)$/i.test(path);
}
