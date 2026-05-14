/**
 * 代码 Diff 视图：渲染 hunk/行信息，并支持行级评论的定位与提交。
 */
import React from 'react';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../shared/types';
import { CommentPopover } from './CommentPopover';
import styles from '../styles.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  viewMode: 'inline' | 'split';
};

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

export function CodeDiffViewer({ file, threads, onCreate, viewMode }: Props) {
  const [activeLine, setActiveLine] = React.useState<string | null>(null);

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
      <div className={rowClass} key={anchorKey}>
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
        {activeLine === anchorKey && lineNumber ? (
          <CommentPopover
            onCancel={() => setActiveLine(null)}
            onSubmit={async (body) => {
              await onCreate({ type: 'diff-line', filePath: file.path, side, lineNumber }, body);
              setActiveLine(null);
            }}
          />
        ) : null}
        {lineThreads.length > 0 ? <span className={styles.lineBadge}>{lineThreads.length}</span> : null}
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
      <div className={className} key={cellKey}>
        <button className={styles.lineNo} onClick={() => cell.lineNumber && setActiveLine(cellKey)}>{cell.lineNumber ?? ''}</button>
        <span className={cell.type === 'add' ? `${styles.lineSign} ${styles.signAdd}` : cell.type === 'remove' ? `${styles.lineSign} ${styles.signRemove}` : styles.lineSign}>
          {getLineSign(cell.type)}
        </span>
        <pre className={styles.codeLine}>{cell.content || ' '}</pre>
        {activeLine === cellKey && cell.lineNumber ? (
          <CommentPopover
            onCancel={() => setActiveLine(null)}
            onSubmit={async (body) => {
              await onCreate({ type: 'diff-line', filePath: file.path, side: cell.side, lineNumber: cell.lineNumber! }, body);
              setActiveLine(null);
            }}
          />
        ) : null}
        {cellThreads.length > 0 ? <span className={styles.lineBadge}>{cellThreads.length}</span> : null}
      </div>
    );
  }

  return (
    <div className={styles.diffCard}>
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
