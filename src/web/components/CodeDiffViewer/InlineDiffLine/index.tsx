/**
 * InlineDiffLine 组件：渲染 inline 模式下的单行 diff 与行级评论入口。
 */
import React from 'react';
import { MessageOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../../../shared/types';
import { CommentPopover } from '../../CommentPopover';
import { getLineSign } from '../utils';
import { InlineThreadStack } from '../InlineThreadStack';
import { useReviewActions } from '../../../contexts/ReviewActionsContext';
import styles from './index.module.less';

type Props = {
  filePath: string;
  line: DiffFile['hunks'][number]['lines'][number];
  index: number;
  hunkKey: string;
  preferredSide?: 'old' | 'new';
  activeLine: string | null;
  setActiveLine: React.Dispatch<React.SetStateAction<string | null>>;
  threads: ReviewThread[];
};

export function InlineDiffLine({
  filePath,
  line,
  index,
  hunkKey,
  preferredSide,
  activeLine,
  setActiveLine,
  threads
}: Props) {
  const { createThread } = useReviewActions();
  const side = preferredSide ?? (line.type === 'remove' ? 'old' : 'new');
  const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
  const anchorKey = `${hunkKey}-${side}-${lineNumber}-${index}`;
  const lineThreads = threads.filter(
    (thread) =>
      thread.anchor.type === 'diff-line' &&
      thread.anchor.filePath === filePath &&
      thread.anchor.side === side &&
      thread.anchor.lineNumber === lineNumber
  );
  const rowClass =
    line.type === 'add' ? `${styles.diffRow} ${styles.add}` : line.type === 'remove' ? `${styles.diffRow} ${styles.remove}` : styles.diffRow;

  return (
    <div className={rowClass} data-review-anchor={`${side}:${lineNumber}`}>
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
            await createThread({ type: 'diff-line', filePath, side, lineNumber }, body);
            setActiveLine(null);
          }}
        />
      ) : null}
      <InlineThreadStack threads={lineThreads} />
    </div>
  );
}
