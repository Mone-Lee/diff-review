/**
 * CodeDiffViewer 行为 hooks：封装数据加载与滚动定位相关副作用。
 */
import React from 'react';
import type { CommentAnchor, ReviewThread } from '../../../shared/types';
import type { FileContents, GapDescriptor } from './types';
import { findGapForAnchor, getDiffAnchorKey, getFirstFileThread, scrollToContentTop, scrollToTarget } from './utils';

export function useDiffFileContents(filePath: string) {
  const [fileContents, setFileContents] = React.useState<FileContents | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setFileContents(null);

    async function loadFileContents() {
      try {
        const res = await fetch(`/api/diff-file-contents?path=${encodeURIComponent(filePath)}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as FileContents;
        if (!cancelled) {
          setFileContents(data);
        }
      } catch {
        if (!cancelled) {
          setFileContents(null);
        }
      }
    }

    void loadFileContents();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filePath]);

  return fileContents;
}

type UseAutoScrollArgs = {
  filePath: string;
  viewMode: 'inline' | 'split';
  threads: ReviewThread[];
  fileContents: FileContents | null;
  gapDescriptors: GapDescriptor[];
  expandedGapLines: Record<string, number>;
  setExpandedGapLines: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  autoScrollKeyRef: React.MutableRefObject<string>;
};

// 首次打开文件时，尽量自动滚动到最早的未解决评论位置。
export function useAutoScrollToFirstThread({
  filePath,
  viewMode,
  threads,
  fileContents,
  gapDescriptors,
  expandedGapLines,
  setExpandedGapLines,
  scrollRef,
  autoScrollKeyRef
}: UseAutoScrollArgs) {
  React.useLayoutEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const autoScrollKey = `${filePath}:${viewMode}`;
    if (autoScrollKeyRef.current === autoScrollKey) return;

    const firstThread = getFirstFileThread(filePath, threads);
    if (!firstThread || firstThread.anchor.type === 'file') {
      scrollToContentTop(scrollContainer);
      autoScrollKeyRef.current = autoScrollKey;
      return;
    }

    const anchorKey = getDiffAnchorKey(firstThread);
    const target = anchorKey
      ? scrollContainer.querySelector<HTMLElement>(`[data-review-anchor="${CSS.escape(anchorKey)}"]`)
      : null;
    if (!target) {
      if (!fileContents) {
        return;
      }
      const side = firstThread.anchor.type === 'diff-line' ? firstThread.anchor.side : null;
      const lineNumber = firstThread.anchor.type === 'diff-line' ? firstThread.anchor.lineNumber : null;
      if (side && lineNumber != null) {
        const gap = findGapForAnchor(gapDescriptors, side, lineNumber);
        if (gap) {
          setExpandedGapLines((current) => ({
            ...current,
            [gap.key]: gap.hiddenCount
          }));
          return;
        }
      }
      scrollToContentTop(scrollContainer);
      autoScrollKeyRef.current = autoScrollKey;
      return;
    }

    scrollToTarget(scrollContainer, target);
    autoScrollKeyRef.current = autoScrollKey;
  }, [
    autoScrollKeyRef,
    expandedGapLines,
    fileContents,
    filePath,
    gapDescriptors,
    scrollRef,
    setExpandedGapLines,
    threads,
    viewMode
  ]);
}

type UseLocateTargetArgs = {
  filePath: string;
  locateTarget: { threadId: string; anchor: CommentAnchor } | null;
  viewMode: 'inline' | 'split';
  fileContents: FileContents | null;
  gapDescriptors: GapDescriptor[];
  expandedGapLines: Record<string, number>;
  setExpandedGapLines: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

// 响应“定位到评论”动作：命中行、gap 展开、最近邻兜底三层策略。
export function useLocateTargetScroll({
  filePath,
  locateTarget,
  viewMode,
  fileContents,
  gapDescriptors,
  expandedGapLines,
  setExpandedGapLines,
  scrollRef
}: UseLocateTargetArgs) {
  React.useLayoutEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || !locateTarget) return;
    if (locateTarget.anchor.filePath !== filePath) return;
    if (locateTarget.anchor.type === 'file') {
      scrollToContentTop(scrollContainer);
      return;
    }
    if (locateTarget.anchor.type !== 'diff-line') return;

    const { side, lineNumber } = locateTarget.anchor;
    const exact = scrollContainer.querySelector<HTMLElement>(`[data-review-anchor="${CSS.escape(`${side}:${lineNumber}`)}"]`);
    if (exact) {
      scrollToTarget(scrollContainer, exact);
      return;
    }

    if (!fileContents) return;

    const gap = findGapForAnchor(gapDescriptors, side, lineNumber);
    if (gap) {
      setExpandedGapLines((current) => ({
        ...current,
        [gap.key]: gap.hiddenCount
      }));
      return;
    }

    const candidates = [...scrollContainer.querySelectorAll<HTMLElement>('[data-review-anchor]')]
      .map((node) => {
        const key = node.dataset.reviewAnchor ?? '';
        const [candidateSide, candidateLineText] = key.split(':');
        const candidateLine = Number(candidateLineText);
        if ((candidateSide !== 'old' && candidateSide !== 'new') || !Number.isFinite(candidateLine)) return null;
        return { node, side: candidateSide as 'old' | 'new', lineNumber: candidateLine };
      })
      .filter((item): item is { node: HTMLElement; side: 'old' | 'new'; lineNumber: number } => Boolean(item))
      .filter((item) => item.side === side)
      .sort((a, b) => Math.abs(a.lineNumber - lineNumber) - Math.abs(b.lineNumber - lineNumber));

    if (candidates[0]) {
      scrollToTarget(scrollContainer, candidates[0].node);
    } else {
      scrollToContentTop(scrollContainer);
    }
  }, [
    expandedGapLines,
    fileContents,
    filePath,
    gapDescriptors,
    locateTarget,
    scrollRef,
    setExpandedGapLines,
    viewMode
  ]);
}
