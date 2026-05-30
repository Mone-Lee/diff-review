/**
 * HunkHeader 组件：渲染 hunk 头部与上下文展开控制按钮。
 */
import React from 'react';
import { VerticalAlignBottomOutlined, VerticalAlignMiddleOutlined, VerticalAlignTopOutlined } from '@ant-design/icons';
import type { ExpandButtonPosition, GapDescriptor, GapExpandDirection } from './types';
import { GAP_EXPAND_STEP } from './utils';
import styles from '../../styles.module.less';

type Props = {
  headerText: string;
  position: ExpandButtonPosition;
  previousGap?: GapDescriptor;
  nextGap?: GapDescriptor;
  getGapVisibleCount: (gap: GapDescriptor) => number;
  getGapHiddenCount: (gap: GapDescriptor) => number;
  onExpandGap: (gap: GapDescriptor, direction?: GapExpandDirection) => void;
  onExpandGapAll: (gap: GapDescriptor, direction?: GapExpandDirection) => void;
  onExpandGapWithAnchor: (
    gap: GapDescriptor,
    anchor: HTMLElement | null,
    options?: { direction?: GapExpandDirection; expandAll?: boolean; alignHeaderToTop?: boolean }
  ) => void;
};

export function HunkHeader({
  headerText,
  position,
  previousGap,
  nextGap,
  getGapVisibleCount,
  getGapHiddenCount,
  onExpandGap,
  onExpandGapAll,
  onExpandGapWithAnchor
}: Props) {
  function renderExpandButton() {
    const canExpandPrevious = previousGap ? getGapVisibleCount(previousGap) < previousGap.hiddenCount : false;
    const canExpandNext = nextGap ? getGapVisibleCount(nextGap) < nextGap.hiddenCount : false;

    if (position === 'top' && previousGap && canExpandPrevious) {
      const hiddenLines = getGapHiddenCount(previousGap);
      const ariaLabel = hiddenLines <= GAP_EXPAND_STEP ? `展开全部 ${hiddenLines} 行隐藏上下文` : `向上展开 ${GAP_EXPAND_STEP} 行隐藏上下文`;
      return (
        <button
          className={styles.hunkHeaderExpand}
          type="button"
          onClick={(event) => {
            const header = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-hunk-header="true"]');
            onExpandGapWithAnchor(previousGap, header, {
              direction: hiddenLines <= GAP_EXPAND_STEP ? undefined : 'up',
              expandAll: hiddenLines <= GAP_EXPAND_STEP,
              alignHeaderToTop: true
            });
          }}
          aria-label={ariaLabel}
        >
          <VerticalAlignTopOutlined />
        </button>
      );
    }

    if (position === 'middle' && previousGap && canExpandPrevious) {
      const hiddenLines = getGapHiddenCount(previousGap);
      if (hiddenLines <= GAP_EXPAND_STEP) {
        const ariaLabel = `展开全部 ${hiddenLines} 行隐藏上下文`;
        return (
          <button
            className={styles.hunkHeaderExpand}
            type="button"
            onClick={(event) => {
              const header = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-hunk-header="true"]');
              onExpandGapWithAnchor(previousGap, header, {
                expandAll: true,
                alignHeaderToTop: true
              });
            }}
            aria-label={ariaLabel}
          >
            <VerticalAlignMiddleOutlined />
          </button>
        );
      }

      const downAriaLabel = `向下展开 ${GAP_EXPAND_STEP} 行隐藏上下文`;
      const upAriaLabel = `向上展开 ${GAP_EXPAND_STEP} 行隐藏上下文`;

      return (
        <>
          <button
            className={styles.hunkHeaderExpand}
            type="button"
            onClick={() => onExpandGap(previousGap, 'down')}
            aria-label={downAriaLabel}
          >
            <VerticalAlignBottomOutlined />
          </button>
          <button
            className={styles.hunkHeaderExpand}
            type="button"
            onClick={(event) => {
              const header = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-hunk-header="true"]');
              onExpandGapWithAnchor(previousGap, header, {
                direction: 'up',
                alignHeaderToTop: true
              });
            }}
            aria-label={upAriaLabel}
          >
            <VerticalAlignTopOutlined />
          </button>
        </>
      );
    }

    if (position === 'bottom' && nextGap && canExpandNext) {
      const hiddenLines = getGapHiddenCount(nextGap);
      if (hiddenLines <= GAP_EXPAND_STEP) {
        const ariaLabel = `展开全部 ${hiddenLines} 行隐藏上下文`;
        return (
          <button
            className={styles.hunkHeaderExpand}
            type="button"
            onClick={(event) => {
              const header = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-hunk-header="true"]');
              onExpandGapWithAnchor(nextGap, header, {
                expandAll: true,
                alignHeaderToTop: true
              });
            }}
            aria-label={ariaLabel}
          >
            <VerticalAlignMiddleOutlined />
          </button>
        );
      }

      const ariaLabel = `向上展开 ${GAP_EXPAND_STEP} 行隐藏上下文`;

      return (
        <button
          className={styles.hunkHeaderExpand}
          type="button"
          onClick={(event) => {
            const header = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-hunk-header="true"]');
            onExpandGapWithAnchor(nextGap, header, {
              direction: 'up',
              alignHeaderToTop: true
            });
          }}
          aria-label={ariaLabel}
        >
          <VerticalAlignTopOutlined />
        </button>
      );
    }

    return null;
  }

  return (
    <div className={styles.hunkHeader} data-hunk-header="true">
      <div className={styles.hunkHeaderRail}>{renderExpandButton()}</div>
      <div className={styles.hunkHeaderBody}>{headerText}</div>
    </div>
  );
}
