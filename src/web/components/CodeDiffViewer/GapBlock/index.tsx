/**
 * GapBlock 组件：渲染 hunk 之间被折叠的上下文区块。
 */
import React from 'react';
import type { DiffFile, ReviewThread } from '../../../../shared/types';
import type { FileContents, GapDescriptor, GapExpandDirection } from '../types';
import { buildGapRows } from '../utils';
import { InlineDiffLine } from '../InlineDiffLine';
import { SplitDiffCell } from '../SplitDiffCell';
import styles from '../../../styles.module.less';

type Props = {
  gap: GapDescriptor;
  filePath: string;
  fileStatus: DiffFile['status'];
  viewMode: 'inline' | 'split';
  fileContents: FileContents | null;
  activeLine: string | null;
  setActiveLine: React.Dispatch<React.SetStateAction<string | null>>;
  threads: ReviewThread[];
  getGapDirection: (gap: GapDescriptor) => GapExpandDirection;
  getGapVisibleCount: (gap: GapDescriptor) => number;
  onExpandGap: (gap: GapDescriptor, direction?: GapExpandDirection) => void;
  onExpandGapAll: (gap: GapDescriptor, direction?: GapExpandDirection) => void;
  leadingHunkHeader?: React.ReactNode;
};

export function GapBlock({
  gap,
  filePath,
  fileStatus,
  viewMode,
  fileContents,
  activeLine,
  setActiveLine,
  threads,
  getGapDirection,
  getGapVisibleCount,
  onExpandGap,
  onExpandGapAll,
  leadingHunkHeader
}: Props) {
  const visibleCount = Math.min(getGapVisibleCount(gap), gap.hiddenCount);
  const remainingCount = gap.hiddenCount - visibleCount;
  const effectiveDirection = getGapDirection(gap);
  const visibleRows = buildGapRows(fileContents, { ...gap, direction: effectiveDirection }, visibleCount);

  return (
    <React.Fragment>
      {leadingHunkHeader}
      {viewMode === 'inline'
        ? visibleRows.map(({ key, line }, index) => (
            <InlineDiffLine
              key={`${key}-${index}`}
              filePath={filePath}
              line={line}
              index={index}
              hunkKey={key}
              preferredSide={gap.mode === 'old' ? 'old' : 'new'}
              activeLine={activeLine}
              setActiveLine={setActiveLine}
              threads={threads}
            />
          ))
        : visibleRows.map(({ key, line }) => (
            <div className={styles.splitRow} key={key}>
              <SplitDiffCell
                cell={
                  line.oldLineNumber
                    ? { lineNumber: line.oldLineNumber, content: line.content, type: 'context', side: 'old' }
                    : { content: '', type: 'empty', side: 'old' }
                }
                rowKey={key}
                filePath={filePath}
                fileStatus={fileStatus}
                activeLine={activeLine}
                setActiveLine={setActiveLine}
                threads={threads}
              />
              <SplitDiffCell
                cell={
                  line.newLineNumber
                    ? { lineNumber: line.newLineNumber, content: line.content, type: 'context', side: 'new' }
                    : { content: '', type: 'empty', side: 'new' }
                }
                rowKey={key}
                filePath={filePath}
                fileStatus={fileStatus}
                activeLine={activeLine}
                setActiveLine={setActiveLine}
                threads={threads}
              />
            </div>
          ))}
    </React.Fragment>
  );
}
