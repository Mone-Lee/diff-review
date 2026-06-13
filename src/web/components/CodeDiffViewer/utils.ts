/**
 * CodeDiffViewer 工具函数：仅包含可复用的纯函数与无副作用辅助逻辑。
 */
import type { CommentAnchor, DiffFile, ReviewThread } from '../../../shared/types';
import type { FileContents, GapDescriptor, RenderedBlock, RenderedGapRow, SplitRow } from './types';

export const GAP_EXPAND_STEP = 20;

function threadAnchorOrder(thread: ReviewThread) {
  if (thread.anchor.type === 'file') return 0;
  return thread.anchor.lineNumber;
}

// 选择文件中最早出现的未解决线程，作为自动滚动目标。
export function getFirstFileThread(filePath: string, threads: ReviewThread[]) {
  return threads
    .filter((thread) => thread.filePath === filePath && thread.status !== 'resolved')
    .sort((left, right) => threadAnchorOrder(left) - threadAnchorOrder(right) || left.createdAt.localeCompare(right.createdAt))[0];
}

export function getCodeViewSide(file: Pick<DiffFile, 'status'>) {
  return file.status === 'deleted' ? 'old' : 'new';
}

export function getCodeViewAnchor(thread: ReviewThread, file: Pick<DiffFile, 'status'>) {
  return getCodeViewAnchorForCommentAnchor(thread.anchor, file);
}

export function getCodeViewAnchorForCommentAnchor(anchor: CommentAnchor, file: Pick<DiffFile, 'status'>) {
  if (anchor.type === 'diff-line') {
    return { side: anchor.side as 'old' | 'new', lineNumber: anchor.lineNumber };
  }
  if (anchor.type === 'markdown-line') {
    return { side: getCodeViewSide(file) as 'old' | 'new', lineNumber: anchor.lineNumber };
  }
  return null;
}

export function getCodeViewAnchorKey(thread: ReviewThread, file: Pick<DiffFile, 'status'>) {
  const anchor = getCodeViewAnchor(thread, file);
  if (!anchor) return null;
  return `${anchor.side}:${anchor.lineNumber}`;
}

function getHunkEndLine(hunk: DiffFile['hunks'][number], side: 'old' | 'new') {
  if (side === 'old') return hunk.oldLines > 0 ? hunk.oldStart + hunk.oldLines - 1 : hunk.oldStart - 1;
  return hunk.newLines > 0 ? hunk.newStart + hunk.newLines - 1 : hunk.newStart - 1;
}

// 根据 hunk 边界计算被折叠的上下文区段（gap）。
export function buildGapDescriptors(file: DiffFile, fileContents: FileContents | null): GapDescriptor[] {
  if (!fileContents || file.hunks.length === 0) return [];

  const descriptors: GapDescriptor[] = [];
  let previousOldEnd = 0;
  let previousNewEnd = 0;

  file.hunks.forEach((hunk, index) => {
    const oldHiddenCount = Math.max(0, hunk.oldStart - previousOldEnd - 1);
    const newHiddenCount = Math.max(0, hunk.newStart - previousNewEnd - 1);
    const mode: GapDescriptor['mode'] =
      file.status === 'added' ? 'new' : file.status === 'deleted' ? 'old' : 'both';
    const hiddenCount = mode === 'old' ? oldHiddenCount : mode === 'new' ? newHiddenCount : Math.max(oldHiddenCount, newHiddenCount);

    if (hiddenCount > 0) {
      descriptors.push({
        key: `${file.path}-gap-${index}`,
        mode,
        hiddenCount,
        oldStart: previousOldEnd + 1,
        oldEnd: hunk.oldStart - 1,
        newStart: previousNewEnd + 1,
        newEnd: hunk.newStart - 1,
        direction: 'up',
        position: index
      });
    }

    previousOldEnd = getHunkEndLine(hunk, 'old');
    previousNewEnd = getHunkEndLine(hunk, 'new');
  });

  const tailOldHidden = Math.max(0, fileContents.oldTotalLines - previousOldEnd);
  const tailNewHidden = Math.max(0, fileContents.newTotalLines - previousNewEnd);
  const tailMode: GapDescriptor['mode'] =
    file.status === 'added' ? 'new' : file.status === 'deleted' ? 'old' : 'both';
  const tailHiddenCount = tailMode === 'old' ? tailOldHidden : tailMode === 'new' ? tailNewHidden : Math.max(tailOldHidden, tailNewHidden);

  if (tailHiddenCount > 0) {
    descriptors.push({
      key: `${file.path}-gap-tail`,
      mode: tailMode,
      hiddenCount: tailHiddenCount,
      oldStart: previousOldEnd + 1,
      oldEnd: fileContents.oldTotalLines,
      newStart: previousNewEnd + 1,
      newEnd: fileContents.newTotalLines,
      direction: 'down',
      position: 'tail'
    });
  }

  return descriptors;
}

export function buildGapRows(fileContents: FileContents | null, gap: GapDescriptor, visibleCount: number): RenderedGapRow[] {
  if (!fileContents || visibleCount <= 0) return [];

  const rows: RenderedGapRow[] = [];
  const oldStart = gap.oldStart > 0 ? gap.oldStart : 1;
  const oldEnd = gap.oldEnd > 0 ? gap.oldEnd : 0;
  const newStart = gap.newStart > 0 ? gap.newStart : 1;
  const newEnd = gap.newEnd > 0 ? gap.newEnd : 0;
  const direction = gap.direction;
  const oldSliceStart = direction === 'down' ? oldStart : Math.max(oldStart, oldEnd - visibleCount + 1);
  const newSliceStart = direction === 'down' ? newStart : Math.max(newStart, newEnd - visibleCount + 1);

  for (let index = 0; index < visibleCount; index += 1) {
    const oldLineNumber = gap.mode === 'new' ? undefined : oldSliceStart + index;
    const newLineNumber = gap.mode === 'old' ? undefined : newSliceStart + index;
    const content =
      gap.mode === 'old'
        ? fileContents.oldLines[oldLineNumber ? oldLineNumber - 1 : 0] ?? ''
        : gap.mode === 'new'
          ? fileContents.newLines[newLineNumber ? newLineNumber - 1 : 0] ?? ''
          : fileContents.oldLines[oldLineNumber ? oldLineNumber - 1 : 0] ?? fileContents.newLines[newLineNumber ? newLineNumber - 1 : 0] ?? '';

    rows.push({
      key: `${gap.key}-${index}`,
      line: {
        type: 'context',
        content,
        oldLineNumber,
        newLineNumber
      }
    });
  }

  return rows;
}

export function buildRenderedBlocks(file: DiffFile, gapByPosition: Map<number | 'tail', GapDescriptor>): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];

  file.hunks.forEach((hunk, index) => {
    const gap = gapByPosition.get(index);
    if (gap) {
      blocks.push({ type: 'gap', key: gap.key, gap, nextHunk: hunk, nextIndex: index });
    }
    blocks.push({ type: 'hunk', key: `${hunk.header}-${index}`, hunk, index });
  });

  const tailGap = gapByPosition.get('tail');
  if (tailGap) {
    blocks.push({ type: 'gap', key: tailGap.key, gap: tailGap });
  }

  return blocks;
}

export function scrollToContentTop(scrollContainer: HTMLElement) {
  scrollContainer.scrollTop = 0;
}

export function scrollToTarget(scrollContainer: HTMLElement, target: HTMLElement) {
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  scrollContainer.scrollTop += targetRect.top - containerRect.top;
}

export function getLineSign(type: 'context' | 'add' | 'remove' | 'empty') {
  if (type === 'add') return '+';
  if (type === 'remove') return '-';
  return '';
}

// 将 hunk 按左右并排格式重组，便于 split 视图统一渲染。
export function buildSplitRows(hunk: DiffFile['hunks'][number]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;

  while (index < hunk.lines.length) {
    const current = hunk.lines[index];

    if (current.type === 'context') {
      rows.push({
        key: `${hunk.header}-context-${index}`,
        oldCell: { lineNumber: current.oldLineNumber, content: current.content, type: 'context', side: 'old' },
        newCell: { lineNumber: current.newLineNumber, content: current.content, type: 'context', side: 'new' }
      });
      index += 1;
      continue;
    }

    if (current.type === 'remove') {
      const removes: typeof hunk.lines = [];
      const adds: typeof hunk.lines = [];
      while (index < hunk.lines.length && hunk.lines[index].type === 'remove') {
        removes.push(hunk.lines[index]);
        index += 1;
      }
      while (index < hunk.lines.length && hunk.lines[index].type === 'add') {
        adds.push(hunk.lines[index]);
        index += 1;
      }
      const length = Math.max(removes.length, adds.length);
      for (let pairIndex = 0; pairIndex < length; pairIndex += 1) {
        const oldLine = removes[pairIndex];
        const newLine = adds[pairIndex];
        rows.push({
          key: `${hunk.header}-change-${index}-${pairIndex}`,
          oldCell: oldLine
            ? { lineNumber: oldLine.oldLineNumber, content: oldLine.content, type: 'remove', side: 'old' }
            : { content: '', type: 'empty', side: 'old' },
          newCell: newLine
            ? { lineNumber: newLine.newLineNumber, content: newLine.content, type: 'add', side: 'new' }
            : { content: '', type: 'empty', side: 'new' }
        });
      }
      continue;
    }

    rows.push({
      key: `${hunk.header}-add-${index}`,
      oldCell: { content: '', type: 'empty', side: 'old' },
      newCell: { lineNumber: current.newLineNumber, content: current.content, type: 'add', side: 'new' }
    });
    index += 1;
  }

  return rows;
}

export function findGapForAnchor(gapDescriptors: GapDescriptor[], side: 'old' | 'new', lineNumber: number) {
  return (
    gapDescriptors.find((gap) => {
      if (gap.mode === 'new' && side === 'old') return false;
      if (gap.mode === 'old' && side === 'new') return false;

      const start = side === 'old' ? gap.oldStart : gap.newStart;
      const end = side === 'old' ? gap.oldEnd : gap.newEnd;
      return lineNumber >= start && lineNumber <= end;
    }) ?? null
  );
}
