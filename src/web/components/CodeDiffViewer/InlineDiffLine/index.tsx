/**
 * InlineDiffLine 组件：渲染 inline 模式下的单行 diff 与行级评论入口。
 */
import React from 'react';
import { MessageOutlined } from '@ant-design/icons';
import type { CommentAnchor, DiffFile, ReviewThread } from '../../../../shared/types';
import { CommentPopover } from '../../CommentPopover';
import type { InlineChangeRange } from '../types';
import { getLineSign } from '../utils';
import { InlineThreadStack } from '../InlineThreadStack';
import { GherkinLine } from '../GherkinLine';
import { useReviewActions } from '../../../contexts/ReviewActionsContext';
import styles from './index.module.less';

type Props = {
  filePath: string;
  changes?: InlineChangeRange[];
  /** 全文预览仅显示当前行号，省略 diff 标记。 */
  contentOnly?: boolean;
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
  contentOnly = false,
  changes,
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
    <div className={contentOnly ? `${rowClass} ${styles.contentOnlyRow}` : rowClass} data-review-anchor={`${side}:${lineNumber}`}>
      {!contentOnly ? (
        <button className={styles.lineNo} onClick={() => line.oldLineNumber && setActiveLine(anchorKey)}>
          {line.oldLineNumber ?? ''}
        </button>
      ) : null}
      <button className={styles.lineNo} onClick={() => line.newLineNumber && setActiveLine(anchorKey)}>
        {line.newLineNumber ?? ''}
      </button>
      {!contentOnly ? (
        <span className={line.type === 'add' ? `${styles.lineSign} ${styles.signAdd}` : line.type === 'remove' ? `${styles.lineSign} ${styles.signRemove}` : styles.lineSign}>
          {getLineSign(line.type)}
        </span>
      ) : null}
      <pre className={styles.codeLine}><GherkinLine filePath={filePath} content={line.content} changes={changes} changeType={line.type} /></pre>
      {lineNumber && lineThreads.length === 0 ? (
        <button className={styles.commentTrigger} type="button" aria-label="添加行评论" onClick={() => setActiveLine(anchorKey)}>
          <MessageOutlined />
        </button>
      ) : null}
      {activeLine === anchorKey && lineNumber ? (
        <CommentPopover
          onCancel={() => setActiveLine(null)}
          onSubmit={async (body, attachments) => {
            await createThread({ type: 'diff-line', filePath, side, lineNumber }, body, attachments);
            setActiveLine(null);
          }}
        />
      ) : null}
      <InlineThreadStack threads={lineThreads} />
    </div>
  );
}
