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
import styles from './index.module.less';
import { MarkdownCommentBlock } from '../MarkdownCommentBlock';
import { MermaidDiagram } from '../MermaidDiagram';

const MARKDOWN_REMARK_PLUGINS = [remarkFrontmatter, remarkGfm];

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  locateTarget: { threadId: string; anchor: CommentAnchor } | null;
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

function threadAnchorOrder(thread: ReviewThread) {
  if (thread.anchor.type === 'file') return 0;
  if (thread.anchor.type === 'markdown-line') return thread.anchor.lineNumber;
  return Number.MAX_SAFE_INTEGER;
}

function getFirstFileThread(filePath: string, threads: ReviewThread[]) {
  return threads
    .filter((thread) => thread.filePath === filePath && thread.status !== 'resolved')
    .sort((left, right) => threadAnchorOrder(left) - threadAnchorOrder(right) || left.createdAt.localeCompare(right.createdAt))[0];
}

function scrollToContentTop(scrollContainer: HTMLElement) {
  scrollContainer.scrollTop = 0;
}

function scrollToTarget(scrollContainer: HTMLElement, target: HTMLElement) {
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  scrollContainer.scrollTop += targetRect.top - containerRect.top;
}

function findMarkdownAnchor(scrollContainer: HTMLElement, lineNumber: number) {
  const anchors = [...scrollContainer.querySelectorAll<HTMLElement>('[data-review-line]')];
  const previousAnchors = anchors.filter((anchor) => Number(anchor.dataset.reviewLine) <= lineNumber);
  return previousAnchors.at(-1) ?? anchors.find((anchor) => Number(anchor.dataset.reviewLine) >= lineNumber) ?? null;
}

function getMarkdownScrollLine(preview: MarkdownPreview, lineNumber: number) {
  const containingBlock = preview.blocks.find((block) => lineNumber >= block.startLine && lineNumber <= block.endLine);
  if (containingBlock) return containingBlock.startLine;

  const nextBlock = preview.blocks.find((block) => block.startLine >= lineNumber);
  return nextBlock?.startLine ?? preview.blocks.at(-1)?.startLine ?? lineNumber;
}

// 仅允许常见安全协议与站内相对路径，拦截 javascript: 等危险链接。
function isSafeUrl(url: string) {
  return /^(https?:|mailto:|#|\.{0,2}\/|\/)/i.test(url.trim());
}

function normalizePathSegments(path: string) {
  const segments = path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized;
}

function resolveAssetPath(markdownPath: string, rawUrl: string) {
  if (!rawUrl || /^https?:|^mailto:|^#/i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith('/')) return rawUrl;

  const cleanUrl = rawUrl.split('#')[0]?.split('?')[0] ?? rawUrl;
  const fileSegments = normalizePathSegments(markdownPath);
  fileSegments.pop();
  const targetSegments = normalizePathSegments(cleanUrl);
  const resolvedPath = [...fileSegments, ...targetSegments].join('/');
  if (!resolvedPath) return rawUrl;
  return `/api/markdown-asset?path=${encodeURIComponent(resolvedPath)}`;
}

// 从 ReactNode 递归提取纯文本，用于读取 code/pre 的真实文本内容。
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

// 统一 className 形态（string 或 string[]），便于后续解析 language-xxx。
function getClassName(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(' ');
  return typeof value === 'string' ? value : '';
}

// 判断节点是否可作为代码节点处理（含 className 或 children）。
function isElementWithCodeProps(node: React.ReactNode): node is React.ReactElement<{ className?: string; children?: React.ReactNode }> {
  return React.isValidElement<{ className?: string; children?: React.ReactNode }>(node) && Boolean(node.props.className || node.props.children);
}

type HastNode = {
  tagName?: string;
  type?: string;
  value?: string;
  position?: { start?: { line?: number } };
  properties?: { className?: unknown };
  children?: HastNode[];
};

function getNodeStartLine(node: unknown): number | undefined {
  const line = (node as HastNode | undefined)?.position?.start?.line;
  return typeof line === 'number' ? line : undefined;
}

// 从 HAST 的 pre > code 节点中提取 className。
function getCodeClassNameFromHast(node: unknown) {
  const maybePre = node as HastNode | undefined;
  const codeNode = maybePre?.children?.find((child) => child.tagName === 'code');
  return getClassName(codeNode?.properties?.className);
}

// 从 HAST 结构递归拼接文本，作为 ReactNode 提取失败时的兜底。
function extractTextFromHast(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return node.children?.map(extractTextFromHast).join('') ?? '';
}

// 从 HAST 的 pre > code 中读取源码文本。
function getCodeTextFromHast(node: unknown) {
  const maybePre = node as HastNode | undefined;
  const codeNode = maybePre?.children?.find((child) => child.tagName === 'code');
  return extractTextFromHast(codeNode);
}

// 读取指定行原始 markdown，用来识别 blockquote 这类“外层块已可评论”的场景。
// 这样可以避免继续给引用块里的每个段落再包一层评论入口，减少重复入口。
function getMarkdownLineText(markdown: string, lineNumber: number | undefined) {
  if (!lineNumber) return '';
  return markdown.split(/\r?\n/)[lineNumber - 1] ?? '';
}

function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

// 标题顶部留白不再交给 h1-h6 自己的 margin-top 处理，而是交给评论容器负责。
// 这样评论 icon 就能稳定贴着标题文本顶部，而不会因为 heading margin 塌陷/外溢出现错位。
function getHeadingSpacingClass(level: 1 | 2 | 3 | 4 | 5 | 6) {
  if (level === 1) return undefined;
  if (level === 2) return styles.commentBlockSpacingLg;
  return styles.commentBlockSpacingMd;
}

export function MarkdownPreviewPanel({
  file,
  threads,
  locateTarget,
  onCreate,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onCopyThread
}: Props) {
  const [preview, setPreview] = React.useState<MarkdownPreview | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const autoScrollKeyRef = React.useRef('');

  React.useEffect(() => {
    setPreview(null);
    fetch(`/api/markdown-preview?path=${encodeURIComponent(file.path)}`)
      .then((res) => res.json())
      .then((data: MarkdownPreview) => setPreview(data))
      .catch(() => setPreview(null));
  }, [file.path]);

  React.useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (!scrollContainer || !preview || preview.filePath !== file.path) return;

    if (autoScrollKeyRef.current === file.path) return;
    autoScrollKeyRef.current = file.path;

    const firstThread = getFirstFileThread(file.path, threads);
    window.requestAnimationFrame(() => {
      if (!firstThread || firstThread.anchor.type === 'file' || firstThread.anchor.type !== 'markdown-line') {
        scrollToContentTop(scrollContainer);
        return;
      }

      const scrollLine = getMarkdownScrollLine(preview, firstThread.anchor.lineNumber);
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
    if (locateTarget.anchor.type !== 'markdown-line') return;

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
      if (thread.anchor.type !== 'markdown-line' || thread.anchor.filePath !== file.path) continue;
      const block = preview?.blocks.find((item) => thread.anchor.type === 'markdown-line' && thread.anchor.lineNumber >= item.startLine && thread.anchor.lineNumber <= item.endLine);
      const displayLineNumber = block?.startLine ?? thread.anchor.lineNumber;
      const lineThreads = nextThreadsByLine.get(displayLineNumber) ?? [];
      lineThreads.push(thread);
      nextThreadsByLine.set(displayLineNumber, lineThreads);
    }
    return nextThreadsByLine;
  }, [file.path, preview?.blocks, threads]);

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
        onCreate={onCreate}
        onLocateThread={onLocateThread}
        onPatchThread={onPatchThread}
        onDeleteThread={onDeleteThread}
        onReplyThread={onReplyThread}
        onPatchComment={onPatchComment}
        onCopyThread={onCopyThread}
      >
        {content}
      </MarkdownCommentBlock>
    );
  }, [
    file.path,
    onCopyThread,
    onCreate,
    onDeleteThread,
    onLocateThread,
    onPatchComment,
    onPatchThread,
    onReplyThread,
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
      if (preview && /^\s*>/.test(getMarkdownLineText(preview.content, getNodeStartLine(node)))) {
        return <p {...props}>{children}</p>;
      }
      return renderCommentableBlock(getNodeStartLine(node), <p {...props}>{children}</p>);
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
