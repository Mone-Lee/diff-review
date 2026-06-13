/**
 * Markdown 预览面板：直接渲染完整文档，保持连续阅读体验。
 * 说明：
 * 1) 通过后端接口获取 markdown 预览内容；
 * 2) 使用 react-markdown + GFM 进行渲染；
 * 3) 对链接/图片做安全协议校验；
 * 4) 对 mermaid 代码块交由 MermaidDiagram 组件渲染。
 */
import React from 'react';
import { Alert, Spin } from 'antd';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { CommentAnchor, DiffFile, MarkdownPreview, ReviewThread } from '../../../shared/types';
import { fetchMarkdownPreview } from '../../api/content';
import styles from './index.module.less';
import { MarkdownCommentBlock } from '../MarkdownCommentBlock';
import { MermaidDiagram } from '../MermaidDiagram';
import {
  extractText,
  findMarkdownAnchor,
  getCodeClassNameFromHast,
  getCodeTextFromHast,
  getHeadingSpacingClass,
  getMarkdownLineText,
  getMarkdownScrollLine,
  getNodeStartLine,
  getFirstFileThread,
  getPreviewThreadLine,
  isElementWithCodeProps,
  isSafeUrl,
  joinClassNames,
  resolveAssetPath,
  scrollToContentTop,
  scrollToTarget
} from './utils';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  locateTarget: { threadId: string; anchor: CommentAnchor } | null;
};
const MARKDOWN_REMARK_PLUGINS = [remarkFrontmatter, remarkGfm];

export function MarkdownPreviewPanel({
  file,
  threads,
  locateTarget
}: Props) {
  const [preview, setPreview] = React.useState<MarkdownPreview | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const autoScrollKeyRef = React.useRef('');

  React.useEffect(() => {
    setPreview(null);
    fetchMarkdownPreview(file.path)
      .then((data) => setPreview(data))
      .catch(() => setPreview(null));
  }, [file.path]);

  React.useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || !preview || preview.filePath !== file.path) return;

    if (autoScrollKeyRef.current === file.path) return;
    autoScrollKeyRef.current = file.path;

    const firstThread = getFirstFileThread(file.path, threads);
    window.requestAnimationFrame(() => {
      const scrollLine = firstThread ? getPreviewThreadLine(preview, firstThread) : null;
      if (!scrollLine) {
        scrollToContentTop(scrollContainer);
        return;
      }

      const target = scrollContainer.querySelector<HTMLElement>(`[data-review-line="${scrollLine}"]`) ?? findMarkdownAnchor(scrollContainer, scrollLine);
      if (!target) {
        scrollToContentTop(scrollContainer);
        return;
      }

      scrollToTarget(scrollContainer, target);
    });
  }, [file.path, preview, threads]);

  React.useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || !preview || !locateTarget) return;
    if (locateTarget.anchor.filePath !== file.path) return;
    if (locateTarget.anchor.type === 'file') {
      scrollToContentTop(scrollContainer);
      return;
    }
    if (locateTarget.anchor.type === 'diff-line' && locateTarget.anchor.side !== 'new') return;

    const scrollLine = getMarkdownScrollLine(preview, locateTarget.anchor.lineNumber);
    const target = scrollContainer.querySelector<HTMLElement>(`[data-review-line="${scrollLine}"]`) ?? findMarkdownAnchor(scrollContainer, scrollLine);
    if (target) {
      scrollToTarget(scrollContainer, target);
    } else {
      scrollToContentTop(scrollContainer);
    }
  }, [file.path, locateTarget, preview]);

  const threadsByLine = React.useMemo(() => {
    const nextThreadsByLine = new Map<number, ReviewThread[]>();
    for (const thread of threads) {
      if (thread.anchor.filePath !== file.path || !preview) continue;
      const displayLineNumber = getPreviewThreadLine(preview, thread);
      if (!displayLineNumber) continue;
      const lineThreads = nextThreadsByLine.get(displayLineNumber) ?? [];
      lineThreads.push(thread);
      nextThreadsByLine.set(displayLineNumber, lineThreads);
    }
    return nextThreadsByLine;
  }, [file.path, preview, threads]);

  // 所有块级评论入口都尽量统一走这一层包装。
  // 例外是 blockquote 内部段落：外层 blockquote 已经可评论时，内部 p 会跳过包装，避免重复入口。
  // 特殊块（标题、表格、mermaid、blockquote）的垂直间距通过 className 加在这里，
  // 避免再用 absolute top 去硬调 icon 位置，从根上减少错位和重叠。
  const renderCommentableBlock = React.useCallback((
    lineNumber: number | undefined,
    content: React.ReactNode,
    options?: { className?: string }
  ) => {
    if (!lineNumber) return content;

    return (
      <MarkdownCommentBlock
        lineNumber={lineNumber}
        filePath={file.path}
        lineThreads={threadsByLine.get(lineNumber) ?? []}
        className={options?.className}
      >
        {content}
      </MarkdownCommentBlock>
    );
  }, [
    file.path,
    threadsByLine
  ]);

  // 标题单独走这一层，是为了统一清掉 heading 自身的 margin-top，
  // 再把顶部留白转移到评论容器，保证评论入口贴着标题文字而不是贴着外边距顶部。
  const renderCommentableHeading = React.useCallback((
    level: 1 | 2 | 3 | 4 | 5 | 6,
    lineNumber: number | undefined,
    props: React.HTMLAttributes<HTMLHeadingElement>,
    children: React.ReactNode,
    extraStyle?: React.CSSProperties
  ) => {
    const Tag = `h${level}` as const;
    return renderCommentableBlock(
      lineNumber,
      React.createElement(
        Tag,
        {
          ...props,
          className: joinClassNames(props.className, styles.markdownHeading),
          style: { ...props.style, ...extraStyle, marginTop: 0 }
        },
        children
      ),
      { className: getHeadingSpacingClass(level) }
    );
  }, [renderCommentableBlock]);

  const markdownComponents = React.useMemo<Components>(() => ({
    h1({ children, node, ...props }) {
      return renderCommentableHeading(1, getNodeStartLine(node), props, children);
    },
    h2({ children, node, style, ...props }) {
      return renderCommentableHeading(2, getNodeStartLine(node), { ...props, style }, children, { marginBottom: 12 });
    },
    h3({ children, node, ...props }) {
      return renderCommentableHeading(3, getNodeStartLine(node), props, children);
    },
    h4({ children, node, ...props }) {
      return renderCommentableHeading(4, getNodeStartLine(node), props, children);
    },
    h5({ children, node, ...props }) {
      return renderCommentableHeading(5, getNodeStartLine(node), props, children);
    },
    h6({ children, node, ...props }) {
      return renderCommentableHeading(6, getNodeStartLine(node), props, children);
    },
    p({ children, node, ...props }) {
      if (preview && /^(?:\s*>|\s*([-*+]|\d+\.)\s+)/.test(getMarkdownLineText(preview.content, getNodeStartLine(node)))) {
        return <p {...props}>{children}</p>;
      }
      return renderCommentableBlock(getNodeStartLine(node), <p {...props}>{children}</p>);
    },
    ul({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <ul {...props}>{children}</ul>);
    },
    ol({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <ol {...props}>{children}</ol>);
    },
    li({ children, node, ...props }) {
      void node;
      return <li {...props}>{children}</li>;
    },
    blockquote({ children, node, ...props }) {
      return renderCommentableBlock(
        getNodeStartLine(node),
        <blockquote {...props} className={joinClassNames(props.className, styles.markdownBlockquote)}>{children}</blockquote>,
        { className: styles.commentBlockSpacingSm }
      );
    },
    // 自定义 pre：识别 mermaid 代码块并替换为图表组件，其余保持普通代码块渲染。
    pre({ children, node, ...props }) {
      const nodes = React.Children.toArray(children);
      const codeElement = nodes.find(isElementWithCodeProps);
      const codeText = extractText(codeElement ?? children) || getCodeTextFromHast(node);
      const codeClassName = codeElement?.props.className ?? getCodeClassNameFromHast(node);
      const language = /language-(\S+)/.exec(codeClassName)?.[1];
      const normalizedCodeText = codeText.replace(/\n$/, '');
      const lineNumber = getNodeStartLine(node);

      if (language === 'mermaid' && normalizedCodeText.trim()) {
        return renderCommentableBlock(
          lineNumber,
          <MermaidDiagram chart={normalizedCodeText} />,
          { className: styles.commentBlockSpacingMd }
        );
      }

      return renderCommentableBlock(
        lineNumber,
        <pre className={styles.markdownPre} {...props}>
          {children}
        </pre>
      );
    },
    // 行内 code 与代码块中的 code 分开样式处理。
    code({ className, children, node, ...props }) {
      void node;
      if (className) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }

      return (
        <code className={styles.markdownInlineCode} {...props}>
          {children}
        </code>
      );
    },
    // 表格包裹横向滚动容器，避免窄屏布局溢出。
    table({ children, node, ...props }) {
      return renderCommentableBlock(
        getNodeStartLine(node),
        <div className={styles.markdownTableScroll}>
          <table {...props}>{children}</table>
        </div>,
        { className: styles.commentBlockSpacingMd }
      );
    },
    // 链接仅在通过安全校验后渲染；外链自动新开窗口。
    a({ href, children, node, ...props }) {
      void node;
      const safeHref = href ?? '';

      if (!safeHref || !isSafeUrl(safeHref)) {
        return <span>{children}</span>;
      }

      const isExternal = /^https?:/i.test(safeHref);
      return (
        <a href={safeHref} target={isExternal ? '_blank' : undefined} rel={isExternal ? 'noreferrer' : undefined} {...props}>
          {children}
        </a>
      );
    },
    // 图片地址仅在通过安全校验后渲染，并启用懒加载。
    img({ src, alt, node, ...props }) {
      void node;
      const safeSrc = src ?? '';

      if (!safeSrc || !isSafeUrl(safeSrc)) {
        return null;
      }

      const resolvedSrc = resolveAssetPath(file.path, safeSrc);
      return (
        <img src={resolvedSrc} alt={alt ?? ''} loading="lazy" {...props} />
      );
    }
  }), [file.path, preview, renderCommentableBlock, renderCommentableHeading]);

  // preview 为 null 时，当前 UI 统一展示 loading 态；加载失败也沿用这一视觉占位。
  if (!preview) {
    return (
      <div className={styles.markdownLoading}>
        <Spin />
      </div>
    );
  }

  return (
    <div className={styles.markdownShell} ref={scrollRef}>
      {preview.deleted ? <Alert className={styles.deletedBanner} message="该文件已删除，仅展示删除前预览" type="warning" showIcon /> : null}
      <article className={styles.markdownArticle}>
        <div className={styles.markdownBody}>
          <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} urlTransform={(url) => (isSafeUrl(url) ? url : '')} components={markdownComponents}>
            {preview.content}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
