/**
 * Markdown 单块评论容器：负责 hover 入口、弹层与当前块的内嵌线程。
 */
import React from 'react';
import { MessageOutlined } from '@ant-design/icons';
import type { ReviewThread } from '../../../shared/types';
import styles from './index.module.less';
import { CommentPopover } from '../CommentPopover';
import { InlineThreadGroup } from '../InlineThreadGroup';
import { useReviewActions } from '../../contexts/ReviewActionsContext';

type Props = {
  lineNumber: number;
  filePath: string;
  lineThreads: ReviewThread[];
  selectionThreads?: ReviewThread[];
  children: React.ReactNode;
  className?: string;
};

// 外层允许透传额外 className，是为了把“块级内容本身的外边距”提升到评论容器上。
// 这样 commentTrigger 永远只需要贴着当前容器顶部，无需再根据不同块类型动态计算 top。
export const MarkdownCommentBlock = React.memo(function MarkdownCommentBlock({
  lineNumber,
  filePath,
  lineThreads,
  selectionThreads = [],
  children,
  className
}: Props) {
  const { createThread } = useReviewActions();
  const [isComposerOpen, setIsComposerOpen] = React.useState(false);
  const blockClassName = [styles.markdownCommentBlock, className].filter(Boolean).join(' ');
  const visibleThreads = [...lineThreads, ...selectionThreads];

  return (
    <div className={blockClassName} data-review-anchor={`line:${lineNumber}`} data-review-line={lineNumber}>
      <div className={styles.markdownCommentContent} data-markdown-comment-content>{children}</div>
      {!isComposerOpen ? (
        <button className={styles.commentTrigger} type="button" aria-label="添加行评论" data-review-ignore-selection onClick={() => setIsComposerOpen(true)}>
          <MessageOutlined />
        </button>
      ) : null}
      {isComposerOpen ? (
        <div data-review-ignore-selection>
          <CommentPopover
            onCancel={() => setIsComposerOpen(false)}
            onSubmit={async (body) => {
              await createThread({ type: 'markdown-line', filePath, lineNumber, blockId: `line-${lineNumber}` }, body);
              setIsComposerOpen(false);
            }}
          />
        </div>
      ) : null}
      {visibleThreads.length > 0 ? (
        <div className={styles.inlineThreadStack} data-review-ignore-selection>
          <InlineThreadGroup threads={visibleThreads} />
        </div>
      ) : null}
    </div>
  );
});
