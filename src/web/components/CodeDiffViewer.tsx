/**
 * 代码 Diff 视图：渲染 hunk/行信息，并支持行级评论的定位与提交。
 */
import React from 'react';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../shared/types';
import type { GapDescriptor, GapExpandDirection } from './CodeDiffViewer/types';
import { useAutoScrollToFirstThread, useDiffFileContents, useLocateTargetScroll } from './CodeDiffViewer/hooks';
import { InlineDiffLine } from './CodeDiffViewer/InlineDiffLine';
import { SplitDiffCell } from './CodeDiffViewer/SplitDiffCell';
import { HunkHeader } from './CodeDiffViewer/HunkHeader';
import { GapBlock } from './CodeDiffViewer/GapBlock';
import {
  buildGapDescriptors,
  buildRenderedBlocks,
  buildSplitRows,
  GAP_EXPAND_STEP,
  scrollToContentTop
} from './CodeDiffViewer/utils';
import styles from '../styles.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  locateTarget: { threadId: string; anchor: CommentAnchor } | null;
  expandAllRequest: { filePath: string; requestId: number } | null;
  onExpandedContextChange: (filePath: string, expanded: boolean) => void;
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
  viewMode: 'inline' | 'split';
};

export function CodeDiffViewer({
  file,
  threads,
  locateTarget,
  expandAllRequest,
  onExpandedContextChange,
  onCreate,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onCopyThread,
  viewMode
}: Props) {
  const [activeLine, setActiveLine] = React.useState<string | null>(null);
  const [expandedGapLines, setExpandedGapLines] = React.useState<Record<string, number>>({});
  const [gapExpandDirection, setGapExpandDirection] = React.useState<Record<string, GapExpandDirection>>({});
  const fileContents = useDiffFileContents(file.path);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const autoScrollKeyRef = React.useRef('');
  const handledExpandRequestRef = React.useRef('');
  const gapDescriptors = React.useMemo(() => buildGapDescriptors(file, fileContents), [file, fileContents]);
  const gapByPosition = React.useMemo(() => {
    const map = new Map<number | 'tail', GapDescriptor>();
    gapDescriptors.forEach((gap) => {
      map.set(gap.position, gap);
    });
    return map;
  }, [gapDescriptors]);
  const renderedBlocks = React.useMemo(() => buildRenderedBlocks(file, gapByPosition), [file, gapByPosition]);
  const hasExpandedContext = React.useMemo(
    () => gapDescriptors.some((gap) => Math.min(expandedGapLines[gap.key] ?? 0, gap.hiddenCount) > 0),
    [gapDescriptors, expandedGapLines]
  );

  React.useEffect(() => {
    setActiveLine(null);
    setExpandedGapLines({});
    setGapExpandDirection({});
    handledExpandRequestRef.current = '';
  }, [file.path]);

  React.useEffect(() => {
    if (!expandAllRequest || expandAllRequest.filePath !== file.path) return;

    const requestKey = `${expandAllRequest.filePath}:${expandAllRequest.requestId}`;
    if (handledExpandRequestRef.current === requestKey) return;
    handledExpandRequestRef.current = requestKey;

    if (hasExpandedContext) {
      setExpandedGapLines({});
      setGapExpandDirection({});
      return;
    }

    setExpandedGapLines((current) => {
      const next = { ...current };
      gapDescriptors.forEach((gap) => {
        next[gap.key] = gap.hiddenCount;
      });
      return next;
    });
  }, [expandAllRequest, file.path, gapDescriptors, hasExpandedContext]);

  React.useEffect(() => {
    onExpandedContextChange(file.path, hasExpandedContext);
  }, [file.path, hasExpandedContext, onExpandedContextChange]);

  useAutoScrollToFirstThread({
    filePath: file.path,
    viewMode,
    threads,
    fileContents,
    gapDescriptors,
    expandedGapLines,
    setExpandedGapLines,
    scrollRef,
    autoScrollKeyRef
  });

  useLocateTargetScroll({
    filePath: file.path,
    locateTarget,
    viewMode,
    fileContents,
    gapDescriptors,
    expandedGapLines,
    setExpandedGapLines,
    scrollRef
  });

  const threadActionProps = {
    onLocateThread,
    onPatchThread,
    onDeleteThread,
    onReplyThread,
    onPatchComment,
    onCopyThread
  };

  function getGapVisibleCount(gap: GapDescriptor) {
    return Math.min(expandedGapLines[gap.key] ?? 0, gap.hiddenCount);
  }

  function getGapDirection(gap: GapDescriptor) {
    return gapExpandDirection[gap.key] ?? gap.direction;
  }

  function expandGapWithAnchor(
    gap: GapDescriptor,
    anchor: HTMLElement | null,
    options?: { direction?: GapExpandDirection; expandAll?: boolean; alignHeaderToTop?: boolean }
  ) {
    const scrollContainer = scrollRef.current;
    const alignHeaderToTop = options?.alignHeaderToTop ?? false;

    if (options?.expandAll) {
      expandGapAll(gap, options.direction);
    } else {
      expandGap(gap, options?.direction);
    }

    if (!alignHeaderToTop || !scrollContainer || !anchor) return;

    window.requestAnimationFrame(() => {
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const afterTop = anchor.getBoundingClientRect().top;
      scrollContainer.scrollTop += afterTop - containerTop;
    });
  }

  function expandGap(gap: GapDescriptor, direction?: GapExpandDirection) {
    if (direction) {
      setGapExpandDirection((current) => ({
        ...current,
        [gap.key]: direction
      }));
    }

    setExpandedGapLines((current) => {
      const visibleCount = Math.min(current[gap.key] ?? 0, gap.hiddenCount);
      const remainingCount = gap.hiddenCount - visibleCount;
      const expandCount = Math.min(GAP_EXPAND_STEP, remainingCount || gap.hiddenCount);
      return {
        ...current,
        [gap.key]: Math.min(gap.hiddenCount, visibleCount + expandCount)
      };
    });
  }

  function expandGapAll(gap: GapDescriptor, direction?: GapExpandDirection) {
    if (direction) {
      setGapExpandDirection((current) => ({
        ...current,
        [gap.key]: direction
      }));
    }

    setExpandedGapLines((current) => ({
      ...current,
      [gap.key]: gap.hiddenCount
    }));
  }

  function getGapHiddenCount(gap: GapDescriptor) {
    return Math.max(0, gap.hiddenCount - getGapVisibleCount(gap));
  }

  function shouldShowHunkHeader(index: number) {
    const previousGap = gapByPosition.get(index);
    if (!previousGap) return false;
    return getGapHiddenCount(previousGap) > 0;
  }

  function shouldRenderHunkHeaderInGap(index: number) {
    const previousGap = gapByPosition.get(index);
    if (!previousGap) return false;
    return getGapVisibleCount(previousGap) > 0 && getGapHiddenCount(previousGap) > 0 && getGapDirection(previousGap) === 'up';
  }

  function getHunkHeaderText(hunk: DiffFile['hunks'][number], index: number) {
    const previousGap = gapByPosition.get(index);
    if (!previousGap) return hunk.header;

    const visibleCount = getGapVisibleCount(previousGap);
    const hiddenCount = getGapHiddenCount(previousGap);
    if (visibleCount <= 0) {
      return `${hunk.header} · 已隐藏 ${hiddenCount} 行上下文`;
    }
    return `${hunk.header} · 已展开 ${visibleCount}/${previousGap.hiddenCount} 行上下文`;
  }

  function renderHunkHeader(hunk: DiffFile['hunks'][number], index: number) {
    const previousGap = gapByPosition.get(index);
    const nextGap = index === file.hunks.length - 1 ? gapByPosition.get('tail') : gapByPosition.get(index + 1);
    const position = index === 0 ? 'top' : 'middle';
    const headerText = getHunkHeaderText(hunk, index);

    return (
      <HunkHeader
        headerText={headerText}
        position={position}
        previousGap={previousGap}
        nextGap={nextGap}
        getGapVisibleCount={getGapVisibleCount}
        getGapHiddenCount={getGapHiddenCount}
        onExpandGap={expandGap}
        onExpandGapAll={expandGapAll}
        onExpandGapWithAnchor={expandGapWithAnchor}
      />
    );
  }

  return (
    <div className={styles.diffCard} ref={scrollRef}>
      {renderedBlocks.map((block) =>
        block.type === 'gap' ? (
          <GapBlock
            key={block.key}
            gap={block.gap}
            filePath={file.path}
            viewMode={viewMode}
            fileContents={fileContents}
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
            getGapDirection={getGapDirection}
            getGapVisibleCount={getGapVisibleCount}
            onExpandGap={expandGap}
            onExpandGapAll={expandGapAll}
            leadingHunkHeader={
              block.nextHunk && block.nextIndex != null && shouldRenderHunkHeaderInGap(block.nextIndex)
                ? renderHunkHeader(block.nextHunk, block.nextIndex)
                : null
            }
          />
        ) : (
          <div className={styles.hunk} key={block.key}>
            {(() => {
              const showHeader = shouldShowHunkHeader(block.index);
              const isHeaderRenderedInGap = shouldRenderHunkHeaderInGap(block.index);
              return (
                <>
                  {showHeader && !isHeaderRenderedInGap ? renderHunkHeader(block.hunk, block.index) : null}
                  {viewMode === 'inline' ? (
                    block.hunk.lines.map((line, index) => (
                      <InlineDiffLine
                        key={`${block.key}-${index}`}
                        filePath={file.path}
                        line={line}
                        index={index}
                        hunkKey={block.key}
                        activeLine={activeLine}
                        setActiveLine={setActiveLine}
                        threads={threads}
                        onCreate={onCreate}
                        {...threadActionProps}
                      />
                    ))
                  ) : (
                    <div className={styles.splitTable}>
                      {buildSplitRows(block.hunk).map((row) => (
                        <div className={styles.splitRow} key={row.key}>
                          <SplitDiffCell
                            cell={row.oldCell}
                            rowKey={row.key}
                            filePath={file.path}
                            activeLine={activeLine}
                            setActiveLine={setActiveLine}
                            threads={threads}
                            onCreate={onCreate}
                            {...threadActionProps}
                          />
                          <SplitDiffCell
                            cell={row.newCell}
                            rowKey={row.key}
                            filePath={file.path}
                            activeLine={activeLine}
                            setActiveLine={setActiveLine}
                            threads={threads}
                            onCreate={onCreate}
                            {...threadActionProps}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )
      )}
    </div>
  );
}
