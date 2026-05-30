/**
 * GapBlock 组件：渲染 hunk 之间被折叠的上下文区块。
 */
import React from 'react';
import { VerticalAlignBottomOutlined, VerticalAlignMiddleOutlined } from '@ant-design/icons';
import type { CommentAnchor, ReviewThread } from '../../../../shared/types';
import type { FileContents, GapDescriptor, GapExpandDirection } from '../types';
import { GAP_EXPAND_STEP, buildGapRows } from '../utils';
import { InlineDiffLine } from '../InlineDiffLine';
import { SplitDiffCell } from '../SplitDiffCell';
import styles from './index.module.less';

type Props = {
  gap: GapDescriptor;
  filePath: string;
  viewMode: 'inline' | 'split';
  fileContents: FileContents | null;
  activeLine: string | null;
  setActiveLine: React.Dispatch<React.SetStateAction<string | null>>;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
  getGapDirection: (gap: GapDescriptor) => GapExpandDirection;
  getGapVisibleCount: (gap: GapDescriptor) => number;
  onExpandGap: (gap: GapDescriptor, direction?: GapExpandDirection) => void;
  onExpandGapAll: (gap: GapDescriptor, direction?: GapExpandDirection) => void;
  leadingHunkHeader?: React.ReactNode;
};

export function GapBlock({
  gap,
  filePath,
  viewMode,
  fileContents,
  activeLine,
  setActiveLine,
  threads,
  onCreate,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onCopyThread,
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
              onCreate={onCreate}
              onLocateThread={onLocateThread}
              onPatchThread={onPatchThread}
              onDeleteThread={onDeleteThread}
              onReplyThread={onReplyThread}
              onPatchComment={onPatchComment}
              onCopyThread={onCopyThread}
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
                activeLine={activeLine}
                setActiveLine={setActiveLine}
                threads={threads}
                onCreate={onCreate}
                onLocateThread={onLocateThread}
                onPatchThread={onPatchThread}
                onDeleteThread={onDeleteThread}
                onReplyThread={onReplyThread}
                onPatchComment={onPatchComment}
                onCopyThread={onCopyThread}
              />
              <SplitDiffCell
                cell={
                  line.newLineNumber
                    ? { lineNumber: line.newLineNumber, content: line.content, type: 'context', side: 'new' }
                    : { content: '', type: 'empty', side: 'new' }
                }
                rowKey={key}
                filePath={filePath}
                activeLine={activeLine}
                setActiveLine={setActiveLine}
                threads={threads}
                onCreate={onCreate}
                onLocateThread={onLocateThread}
                onPatchThread={onPatchThread}
                onDeleteThread={onDeleteThread}
                onReplyThread={onReplyThread}
                onPatchComment={onPatchComment}
                onCopyThread={onCopyThread}
              />
            </div>
          ))}
      {gap.position === 'tail' && remainingCount > 0 && fileContents ? (
        <div className={styles.hunkHeader} data-hunk-header="true">
          <div className={styles.hunkHeaderRail}>
            <button
              className={styles.hunkHeaderExpand}
              type="button"
              onClick={() => (remainingCount <= GAP_EXPAND_STEP ? onExpandGapAll(gap) : onExpandGap(gap, 'down'))}
              aria-label={remainingCount <= GAP_EXPAND_STEP ? `展开全部 ${remainingCount} 行隐藏上下文` : `向下展开 ${GAP_EXPAND_STEP} 行隐藏上下文`}
            >
              {remainingCount <= GAP_EXPAND_STEP ? <VerticalAlignMiddleOutlined /> : <VerticalAlignBottomOutlined />}
            </button>
          </div>
          <div className={styles.hunkHeaderBody} />
        </div>
      ) : null}
    </React.Fragment>
  );
}
