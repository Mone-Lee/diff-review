/**
 * 代码 Diff 视图：渲染 hunk/行信息，并支持行级评论的定位与提交。
 */
import React from 'react';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../../shared/types';
import type { GapDescriptor, GapExpandDirection } from '../CodeDiffViewer/types';
import { useDiffFileContents } from '../CodeDiffViewer/hooks/useDiffFileContents';
import { useAutoScrollToFirstThread, useLocateTargetScroll } from '../CodeDiffViewer/hooks/useDiffScroll';
import { InlineDiffLine } from '../CodeDiffViewer/InlineDiffLine';
import { SplitDiffCell } from '../CodeDiffViewer/SplitDiffCell';
import { HunkHeader } from '../CodeDiffViewer/HunkHeader';
import { GapBlock } from '../CodeDiffViewer/GapBlock';
import {
  buildGapDescriptors,
  buildRenderedBlocks,
  buildSplitRows,
  GAP_EXPAND_STEP,
  scrollToContentTop
} from '../CodeDiffViewer/utils';
import styles from './index.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  locateTarget: { threadId: string; anchor: CommentAnchor } | null;
  expandAllRequest: { filePath: string; requestId: number } | null;
  onExpandedContextChange: (filePath: string, expanded: boolean) => void;
  viewMode: 'inline' | 'split';
};

function getSelectionContainerElement(node: Node | null) {
  if (!node) return null;
  return node instanceof HTMLElement ? node : node.parentElement;
}

function getSplitCopySideFromNode(node: Node | null) {
  const element = getSelectionContainerElement(node);
  const side = element?.closest<HTMLElement>('[data-split-copy-side]')?.dataset.splitCopySide;
  return side === 'old' || side === 'new' ? side : null;
}

function getSelectedSplitTexts(container: HTMLElement, range: Range, side: 'old' | 'new') {
  return [...container.querySelectorAll<HTMLElement>(`[data-split-copy-side="${side}"] [data-split-copy-content="true"]`)]
    .filter((element) => range.intersectsNode(element))
    .map((element) => element.textContent ?? '');
}

function getGapVisibleCount(gap: GapDescriptor, expandedGapLines: Record<string, number>) {
  return Math.min(expandedGapLines[gap.key] ?? 0, gap.hiddenCount);
}

function getGapDirection(gap: GapDescriptor, gapExpandDirection: Record<string, GapExpandDirection>) {
  return gapExpandDirection[gap.key] ?? gap.direction;
}

function setSplitSelectionLock(container: HTMLDivElement | null, side: 'old' | 'new' | null) {
  if (!container) return;
  if (side) {
    container.dataset.selectionLockedSide = side;
    return;
  }
  delete container.dataset.selectionLockedSide;
}

export function CodeDiffViewer({
  file,
  threads,
  locateTarget,
  expandAllRequest,
  onExpandedContextChange,
  viewMode
}: Props) {
  const [activeLine, setActiveLine] = React.useState<string | null>(null);
  const [expandedGapLines, setExpandedGapLines] = React.useState<Record<string, number>>({});
  const [gapExpandDirection, setGapExpandDirection] = React.useState<Record<string, GapExpandDirection>>({});
  const fileContents = useDiffFileContents(file.path, file.snapshotHash);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const splitCopySideRef = React.useRef<'old' | 'new' | null>(null);
  const isSplitSelectingRef = React.useRef(false);
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

  React.useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollToContentTop(scrollRef.current);
      setSplitSelectionLock(scrollRef.current, null);
    }
    setActiveLine(null);
    setExpandedGapLines({});
    setGapExpandDirection({});
    splitCopySideRef.current = null;
    isSplitSelectingRef.current = false;
    handledExpandRequestRef.current = '';
  }, [file.path, file.snapshotHash]);

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

  React.useEffect(() => {
    if (viewMode !== 'split') return;

    function clearSelectionLock() {
      if (!splitCopySideRef.current && !isSplitSelectingRef.current) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString()) return;
      splitCopySideRef.current = null;
      isSplitSelectingRef.current = false;
      setSplitSelectionLock(scrollRef.current, null);
    }

    document.addEventListener('selectionchange', clearSelectionLock);
    window.addEventListener('mouseup', clearSelectionLock);
    window.addEventListener('dragend', clearSelectionLock);
    return () => {
      document.removeEventListener('selectionchange', clearSelectionLock);
      window.removeEventListener('mouseup', clearSelectionLock);
      window.removeEventListener('dragend', clearSelectionLock);
    };
  }, [viewMode]);

  useAutoScrollToFirstThread({
    file,
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
    file,
    filePath: file.path,
    locateTarget,
    viewMode,
    fileContents,
    gapDescriptors,
    expandedGapLines,
    setExpandedGapLines,
    scrollRef
  });

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
    return Math.max(0, gap.hiddenCount - getGapVisibleCount(gap, expandedGapLines));
  }

  function shouldShowHunkHeader(index: number) {
    const previousGap = gapByPosition.get(index);
    if (!previousGap) return false;
    return getGapHiddenCount(previousGap) > 0;
  }

  function shouldRenderHunkHeaderInGap(index: number) {
    const previousGap = gapByPosition.get(index);
    if (!previousGap) return false;
    return getGapVisibleCount(previousGap, expandedGapLines) > 0 && getGapHiddenCount(previousGap) > 0 && getGapDirection(previousGap, gapExpandDirection) === 'up';
  }

  function getHunkHeaderText(hunk: DiffFile['hunks'][number], index: number) {
    const previousGap = gapByPosition.get(index);
    if (!previousGap) return hunk.header;

    const visibleCount = getGapVisibleCount(previousGap, expandedGapLines);
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
        getGapVisibleCount={(gap) => getGapVisibleCount(gap, expandedGapLines)}
        getGapHiddenCount={getGapHiddenCount}
        onExpandGap={expandGap}
        onExpandGapWithAnchor={expandGapWithAnchor}
      />
    );
  }

  function handleMouseDownCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (viewMode !== 'split') return;
    splitCopySideRef.current = event.target instanceof Node ? getSplitCopySideFromNode(event.target) : null;
    isSplitSelectingRef.current = Boolean(splitCopySideRef.current);
    setSplitSelectionLock(scrollRef.current, splitCopySideRef.current);
  }

  function handleMouseMoveCapture(event: React.MouseEvent<HTMLDivElement>) {
    if (viewMode !== 'split' || isSplitSelectingRef.current) return;
    const side = event.target instanceof Node ? getSplitCopySideFromNode(event.target) : null;
    setSplitSelectionLock(scrollRef.current, side);
  }

  function handleMouseLeave() {
    if (isSplitSelectingRef.current) return;
    setSplitSelectionLock(scrollRef.current, null);
  }

  function handleCopy(event: React.ClipboardEvent<HTMLDivElement>) {
    if (viewMode !== 'split') return;

    const selection = window.getSelection();
    const container = scrollRef.current;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !container) return;

    const range = selection.getRangeAt(0);
    const oldTexts = getSelectedSplitTexts(container, range, 'old');
    const newTexts = getSelectedSplitTexts(container, range, 'new');
    if (oldTexts.length === 0 && newTexts.length === 0) return;

    const fallbackSide = file.status === 'deleted' ? 'old' : 'new';
    const preferredSide =
      splitCopySideRef.current ?? getSplitCopySideFromNode(selection.anchorNode) ?? fallbackSide;
    const preferredTexts = preferredSide === 'old' ? oldTexts : newTexts;
    const fallbackTexts = preferredSide === 'old' ? newTexts : oldTexts;
    const text = (preferredTexts.length > 0 ? preferredTexts : fallbackTexts).join('\n');
    if (!text) return;

    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
  }

  return (
    <div
      className={styles.diffCard}
      ref={scrollRef}
      onMouseDownCapture={handleMouseDownCapture}
      onMouseMoveCapture={handleMouseMoveCapture}
      onMouseLeave={handleMouseLeave}
      onCopy={handleCopy}
    >
      {renderedBlocks.map((block) =>
        block.type === 'gap' ? (
          <GapBlock
            key={block.key}
            gap={block.gap}
            filePath={file.path}
            fileStatus={file.status}
            viewMode={viewMode}
            fileContents={fileContents}
            activeLine={activeLine}
            setActiveLine={setActiveLine}
            threads={threads}
            getGapDirection={(gap) => getGapDirection(gap, gapExpandDirection)}
            getGapVisibleCount={(gap) => getGapVisibleCount(gap, expandedGapLines)}
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
                            fileStatus={file.status}
                            activeLine={activeLine}
                            setActiveLine={setActiveLine}
                            threads={threads}
                          />
                          <SplitDiffCell
                            cell={row.newCell}
                            rowKey={row.key}
                            filePath={file.path}
                            fileStatus={file.status}
                            activeLine={activeLine}
                            setActiveLine={setActiveLine}
                            threads={threads}
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
