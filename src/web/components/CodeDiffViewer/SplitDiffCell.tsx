/**
 * SplitDiffCell 组件：渲染 split 模式下单侧单元格及其评论交互。
 */
import React from 'react';
import { MessageOutlined } from '@ant-design/icons';
import type { CommentAnchor, ReviewThread } from '../../../shared/types';
import type { SplitCell } from './types';
import { CommentPopover } from '../CommentPopover';
import { getLineSign } from './utils';
import { InlineThreadStack } from './InlineThreadStack';
import styles from '../../styles.module.less';

type Props = {
  cell: SplitCell;
  rowKey: string;
  filePath: string;
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
};

export function SplitDiffCell({
  cell,
  rowKey,
  filePath,
  activeLine,
  setActiveLine,
  threads,
  onCreate,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onCopyThread
}: Props) {
  const cellThreads = cell.lineNumber
    ? threads.filter(
        (thread) =>
          thread.anchor.type === 'diff-line' &&
          thread.anchor.filePath === filePath &&
          thread.anchor.side === cell.side &&
          thread.anchor.lineNumber === cell.lineNumber
      )
    : [];
  const cellKey = `${rowKey}-${cell.side}-${cell.lineNumber ?? 'empty'}`;
  const className =
    cell.type === 'add'
      ? `${styles.splitCell} ${styles.add}`
      : cell.type === 'remove'
        ? `${styles.splitCell} ${styles.remove}`
        : cell.type === 'empty'
          ? `${styles.splitCell} ${styles.emptyCell}`
          : styles.splitCell;

  return (
    <div className={className} data-review-anchor={cell.lineNumber ? `${cell.side}:${cell.lineNumber}` : undefined}>
      <button className={styles.lineNo} onClick={() => cell.lineNumber && setActiveLine(cellKey)}>{cell.lineNumber ?? ''}</button>
      <span className={cell.type === 'add' ? `${styles.lineSign} ${styles.signAdd}` : cell.type === 'remove' ? `${styles.lineSign} ${styles.signRemove}` : styles.lineSign}>
        {getLineSign(cell.type)}
      </span>
      <pre className={styles.codeLine}>{cell.content || ' '}</pre>
      {cell.lineNumber && cellThreads.length === 0 ? (
        <button className={styles.commentTrigger} type="button" aria-label="添加行评论" onClick={() => setActiveLine(cellKey)}>
          <MessageOutlined />
        </button>
      ) : null}
      {activeLine === cellKey && cell.lineNumber ? (
        <CommentPopover
          onCancel={() => setActiveLine(null)}
          onSubmit={async (body) => {
            await onCreate({ type: 'diff-line', filePath, side: cell.side, lineNumber: cell.lineNumber! }, body);
            setActiveLine(null);
          }}
        />
      ) : null}
      <InlineThreadStack
        threads={cellThreads}
        onLocateThread={onLocateThread}
        onPatchThread={onPatchThread}
        onDeleteThread={onDeleteThread}
        onReplyThread={onReplyThread}
        onPatchComment={onPatchComment}
        onCopyThread={onCopyThread}
      />
    </div>
  );
}
