/**
 * CodeDiffViewer 子模块类型定义：统一管理 diff 视图拆分后的共享类型。
 */
import type { DiffFile, DiffLine } from '../../../shared/types';

/** 行内变更在原始文本中的 UTF-16 范围，左闭右开，与字符串切片保持一致。 */
export type InlineChangeRange = { start: number; end: number };

export type SplitCell = {
  /** 仅配对的替换行具有行内范围，未配对增删行沿用整行底色。 */
  changes?: InlineChangeRange[];
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
