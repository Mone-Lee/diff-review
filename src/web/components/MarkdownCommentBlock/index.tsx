/**
 * Markdown 单块评论容器：负责 hover 入口、弹层与当前块的内嵌线程。
 */
import React from 'react';
import { MessageOutlined } from '@ant-design/icons';
import type { CommentAnchor, ReviewThread } from '../../../shared/types';
import styles from './index.module.less';
import { CommentPopover } from '../CommentPopover';
import { InlineThreadGroup } from '../InlineThreadGroup';

type Props = {
  lineNumber: number;
  filePath: string;
  lineThreads: ReviewThread[];
  children: React.ReactNode;
  className?: string;
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

// 外层允许透传额外 className，是为了把“块级内容本身的外边距”提升到评论容器上。
// 这样 commentTrigger 永远只需要贴着当前容器顶部，无需再根据不同块类型动态计算 top。
export const MarkdownCommentBlock = React.memo(function MarkdownCommentBlock({
  lineNumber,
  filePath,
  lineThreads,
  children,
  className,
  onCreate,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onCopyThread
}: Props) {
  const [isComposerOpen, setIsComposerOpen] = React.useState(false);
  const blockClassName = [styles.markdownCommentBlock, className].filter(Boolean).join(' ');

  return (
    <div className={blockClassName} data-review-anchor={`line:${lineNumber}`} data-review-line={lineNumber}>
      <div className={styles.markdownCommentContent}>{children}</div>
      {lineThreads.length === 0 ? (
        <button className={styles.commentTrigger} type="button" aria-label="添加行评论" onClick={() => setIsComposerOpen(true)}>
          <MessageOutlined />
        </button>
      ) : null}
      {isComposerOpen ? (
        <CommentPopover
          onCancel={() => setIsComposerOpen(false)}
          onSubmit={async (body) => {
            await onCreate({ type: 'markdown-line', filePath, lineNumber, blockId: `line-${lineNumber}` }, body);
            setIsComposerOpen(false);
          }}
        />
      ) : null}
      {lineThreads.length > 0 ? (
        <div className={styles.inlineThreadStack}>
          <InlineThreadGroup
            threads={lineThreads}
            onFocus={onLocateThread}
            onPatch={onPatchThread}
            onDeleteThread={onDeleteThread}
            onReply={onReplyThread}
            onPatchComment={onPatchComment}
            onCopy={onCopyThread}
          />
        </div>
      ) : null}
    </div>
  );
});
