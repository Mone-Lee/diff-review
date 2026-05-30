/**
 * CodeDiffViewer 子模块类型定义：统一管理 diff 视图拆分后的共享类型。
 */
import type { DiffFile, DiffLine } from '../../../shared/types';

export type SplitCell = {
  lineNumber?: number;
  content: string;
  type: 'context' | 'add' | 'remove' | 'empty';
  side: 'old' | 'new';
};

export type SplitRow = {
  key: string;
  oldCell: SplitCell;
  newCell: SplitCell;
};

export type FileContents = {
  oldLines: string[];
  newLines: string[];
  oldTotalLines: number;
  newTotalLines: number;
};

export type GapDescriptor = {
  key: string;
  mode: 'old' | 'new' | 'both';
  hiddenCount: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  direction: 'up' | 'down';
  position: number | 'tail';
};

export type GapExpandDirection = 'up' | 'down';
export type ExpandButtonPosition = 'top' | 'middle' | 'bottom';

export type RenderedGapRow = { key: string; line: DiffLine };

export type RenderedBlock =
  | { type: 'hunk'; key: string; hunk: DiffFile['hunks'][number]; index: number }
  | { type: 'gap'; key: string; gap: GapDescriptor; nextHunk?: DiffFile['hunks'][number]; nextIndex?: number };
