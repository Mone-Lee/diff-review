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
};

export function CodeDiffViewer({ file, threads, onCreate }: Props) {
  const [activeLine, setActiveLine] = React.useState<string | null>(null);

  return (
    <div className={styles.diffCard}>
      {file.hunks.map((hunk) => (
        <div className={styles.hunk} key={hunk.header}>
          <div className={styles.hunkHeader}>{hunk.header}</div>
          {hunk.lines.map((line, index) => {
            // 删除行锚定到 old 侧，新增/上下文锚定到 new 侧。
            const side = line.type === 'remove' ? 'old' : 'new';
            const lineNumber = side === 'old' ? line.oldLineNumber : line.newLineNumber;
            const anchorKey = `${side}-${lineNumber}-${index}`;
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
                <button className={styles.lineNo} onClick={() => lineNumber && setActiveLine(anchorKey)}>
                  {line.oldLineNumber ?? ''}
                </button>
                <button className={styles.lineNo} onClick={() => lineNumber && setActiveLine(anchorKey)}>
                  {line.newLineNumber ?? ''}
                </button>
                <pre className={styles.codeLine}>{line.content || ' '}</pre>
                {activeLine === anchorKey && lineNumber ? (
                  <CommentPopover
                    onCancel={() => setActiveLine(null)}
                    onSubmit={async (body) => {
                      // 行级评论统一走 diff-line 锚点，后端据此持久化。
                      await onCreate({ type: 'diff-line', filePath: file.path, side, lineNumber }, body);
                      setActiveLine(null);
                    }}
                  />
                ) : null}
                {lineThreads.length > 0 ? <span className={styles.lineBadge}>{lineThreads.length}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
