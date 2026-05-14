/**
 * Markdown 预览面板：渲染块级预览并支持基于源行的评论定位。
 */
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CommentAnchor, DiffFile, MarkdownPreview, ReviewThread } from '../../shared/types';
import { CommentPopover } from './CommentPopover';
import styles from '../styles.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
};

export function MarkdownPreviewPanel({ file, threads, onCreate }: Props) {
  const [preview, setPreview] = React.useState<MarkdownPreview | null>(null);
  const [activeBlock, setActiveBlock] = React.useState<string | null>(null);

  React.useEffect(() => {
    setPreview(null);
    // 文件切换后重新拉取块级映射，确保评论锚点与最新预览一致。
    fetch(`/api/markdown-preview?path=${encodeURIComponent(file.path)}`)
      .then((res) => res.json())
      .then((data: MarkdownPreview) => setPreview(data))
      .catch(() => setPreview(null));
  }, [file.path]);

  if (!preview) return <div className={styles.emptyState}>正在渲染 Markdown 预览...</div>;

  return (
    <div className={styles.markdownShell}>
      {preview.deleted ? <div className={styles.deletedBanner}>该文件已删除，仅展示删除前预览</div> : null}
      {preview.blocks.map((block) => {
        const blockThreads = threads.filter(
          (thread) =>
            thread.anchor.type === 'markdown-line' &&
            thread.anchor.filePath === file.path &&
            thread.anchor.lineNumber >= block.startLine &&
            thread.anchor.lineNumber <= block.endLine
        );
        return (
          <section className={styles.mdBlock} key={block.id}>
            <button className={styles.mdLine} onClick={() => setActiveBlock(block.id)}>
              L{block.startLine}
            </button>
            <div className={styles.markdownBody}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
            </div>
            {blockThreads.length > 0 ? <span className={`${styles.lineBadge} ${styles.mdBadge}`}>{blockThreads.length}</span> : null}
            {activeBlock === block.id ? (
              <CommentPopover
                onCancel={() => setActiveBlock(null)}
                onSubmit={async (body) => {
                  await onCreate({ type: 'markdown-line', filePath: file.path, lineNumber: block.startLine, blockId: block.id }, body);
                  setActiveBlock(null);
                }}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
