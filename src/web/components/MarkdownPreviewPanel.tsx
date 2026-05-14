/**
 * Markdown 预览面板：直接渲染完整文档，保持连续阅读体验。
 */
import React from 'react';
import { Alert, Spin } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CommentAnchor, DiffFile, MarkdownPreview, ReviewThread } from '../../shared/types';
import styles from '../styles.module.less';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
};

export function MarkdownPreviewPanel({ file, threads, onCreate }: Props) {
  const [preview, setPreview] = React.useState<MarkdownPreview | null>(null);
  void threads;
  void onCreate;

  React.useEffect(() => {
    setPreview(null);
    fetch(`/api/markdown-preview?path=${encodeURIComponent(file.path)}`)
      .then((res) => res.json())
      .then((data: MarkdownPreview) => setPreview(data))
      .catch(() => setPreview(null));
  }, [file.path]);

  if (!preview) {
    return (
      <div className={styles.markdownLoading}>
        <Spin />
      </div>
    );
  }

  return (
    <div className={styles.markdownShell}>
      {preview.deleted ? <Alert className={styles.deletedBanner} message="该文件已删除，仅展示删除前预览" type="warning" showIcon /> : null}
      <article className={styles.markdownArticle}>
        <div className={styles.markdownBody}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
