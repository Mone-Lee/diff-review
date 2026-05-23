/**
 * 代码 Diff 视图：渲染 hunk/行信息，并支持行级评论的定位与提交。
 */
import React from 'react';
import { MessageOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../shared/types';
import { CommentPopover } from './CommentPopover';
import { InlineThreadGroup } from './InlineThreadGroup';
import styles from '../styles.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
  viewMode: 'inline' | 'split';
};

function threadAnchorOrder(thread: ReviewThread) {
  if (thread.anchor.type === 'file') return 0;
  return thread.anchor.lineNumber;
}

function getFirstFileThread(filePath: string, threads: ReviewThread[]) {
  return threads
    .filter((thread) => thread.filePath === filePath && thread.status !== 'resolved')
    .sort((left, right) => threadAnchorOrder(left) - threadAnchorOrder(right) || left.createdAt.localeCompare(right.createdAt))[0];
}

function getDiffAnchorKey(thread: ReviewThread) {
  if (thread.anchor.type !== 'diff-line') return null;
  return `${thread.anchor.side}:${thread.anchor.lineNumber}`;
}

function scrollToContentTop(scrollContainer: HTMLElement) {
  scrollContainer.scrollTop = 0;
}

function scrollToTarget(scrollContainer: HTMLElement, target: HTMLElement) {
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  scrollContainer.scrollTop += targetRect.top - containerRect.top;
}

type SplitCell = {
  lineNumber?: number;
  content: string;
  type: 'context' | 'add' | 'remove' | 'empty';
  side: 'old' | 'new';
};

function getLineSign(type: 'context' | 'add' | 'remove' | 'empty') {
  if (type === 'add') return '+';
  if (type === 'remove') return '-';
  return '';
}

type SplitRow = {
  key: string;
  oldCell: SplitCell;
  newCell: SplitCell;
};

export function CodeDiffViewer({
  file,
  threads,
  onCreate,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onDeleteComment,
  onCopyThread,
  viewMode
}: Props) {
  const [activeLine, setActiveLine] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const autoScrollKeyRef = React.useRef('');

  React.useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const autoScrollKey = `${file.path}:${viewMode}`;
    if (autoScrollKeyRef.current === autoScrollKey) return;
    autoScrollKeyRef.current = autoScrollKey;

    const firstThread = getFirstFileThread(file.path, threads);
    window.requestAnimationFrame(() => {
      if (!firstThread || firstThread.anchor.type === 'file') {
        scrollToContentTop(scrollContainer);
        return;
      }

      const anchorKey = getDiffAnchorKey(firstThread);
      const target = anchorKey
        ? scrollContainer.querySelector<HTMLElement>(`[data-review-anchor="${CSS.escape(anchorKey)}"]`)
        : null;
      if (!target) {
        scrollToContentTop(scrollContainer);
        return;
      }

      scrollToTarget(scrollContainer, target);
    });
  }, [file.path, threads, viewMode]);

  function renderInlineThreads(lineThreads: ReviewThread[]) {
    if (lineThreads.length === 0) return null;

    return (
      <div className={styles.inlineThreadStack}>
        <InlineThreadGroup
          threads={lineThreads}
          onFocus={onLocateThread}
          onPatch={onPatchThread}
          onDeleteThread={onDeleteThread}
          onReply={onReplyThread}
          onPatchComment={onPatchComment}
          onDeleteComment={onDeleteComment}
          onCopy={onCopyThread}
        />
      </div>
    );
  }

  function renderInlineLine(
    line: DiffFile['hunks'][number]['lines'][number],
    index: number,
    hunkKey: string
  ) {
    const side = line.type === 'remove' ? 'old' : 'new';
    const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
    const anchorKey = `${hunkKey}-${side}-${lineNumber}-${index}`;
    const lineThreads = threads.filter(
      (thread) =>
        thread.anchor.type === 'diff-line' &&
        thread.anchor.filePath === file.path &&
        thread.anchor.side === side &&
        thread.anchor.lineNumber === lineNumber
    );
    const rowClass =
      line.type === 'add' ? `${styles.diffRow} ${styles.add}` : line.type === 'remove' ? `${styles.diffRow} ${styles.remove}` : styles.diffRow;

    return (
      <div className={rowClass} key={anchorKey} data-review-anchor={`${side}:${lineNumber}`}>
        <button className={styles.lineNo} onClick={() => line.oldLineNumber && setActiveLine(anchorKey)}>
          {line.oldLineNumber ?? ''}
        </button>
        <button className={styles.lineNo} onClick={() => line.newLineNumber && setActiveLine(anchorKey)}>
          {line.newLineNumber ?? ''}
        </button>
        <span className={line.type === 'add' ? `${styles.lineSign} ${styles.signAdd}` : line.type === 'remove' ? `${styles.lineSign} ${styles.signRemove}` : styles.lineSign}>
          {getLineSign(line.type)}
        </span>
        <pre className={styles.codeLine}>{line.content || ' '}</pre>
        {lineNumber && lineThreads.length === 0 ? (
          <button className={styles.commentTrigger} type="button" aria-label="添加行评论" onClick={() => setActiveLine(anchorKey)}>
            <MessageOutlined />
          </button>
        ) : null}
        {activeLine === anchorKey && lineNumber ? (
          <CommentPopover
            onCancel={() => setActiveLine(null)}
            onSubmit={async (body) => {
              await onCreate({ type: 'diff-line', filePath: file.path, side, lineNumber }, body);
              setActiveLine(null);
            }}
          />
        ) : null}
        {renderInlineThreads(lineThreads)}
      </div>
    );
  }

  function buildSplitRows(hunk: DiffFile['hunks'][number]): SplitRow[] {
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

  function renderSplitCell(cell: SplitCell, rowKey: string) {
    const cellThreads = cell.lineNumber
      ? threads.filter(
          (thread) =>
            thread.anchor.type === 'diff-line' &&
            thread.anchor.filePath === file.path &&
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
      <div className={className} key={cellKey} data-review-anchor={cell.lineNumber ? `${cell.side}:${cell.lineNumber}` : undefined}>
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
              await onCreate({ type: 'diff-line', filePath: file.path, side: cell.side, lineNumber: cell.lineNumber! }, body);
              setActiveLine(null);
            }}
          />
        ) : null}
        {renderInlineThreads(cellThreads)}
      </div>
    );
  }

  return (
    <div className={styles.diffCard} ref={scrollRef}>
      {file.hunks.map((hunk) => (
        <div className={styles.hunk} key={hunk.header}>
          <div className={styles.hunkHeader}>{hunk.header}</div>
          {viewMode === 'inline' ? (
            hunk.lines.map((line, index) => renderInlineLine(line, index, hunk.header))
          ) : (
            <div className={styles.splitTable}>
              <div className={styles.splitHead}>
                <div>Old</div>
                <div>New</div>
              </div>
              {buildSplitRows(hunk).map((row) => (
                <div className={styles.splitRow} key={row.key}>
                  {renderSplitCell(row.oldCell, row.key)}
                  {renderSplitCell(row.newCell, row.key)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
