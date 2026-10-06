/**
 * Markdown 预览面板：直接渲染完整文档，保持连续阅读体验。
 * 说明：
 * 1) 通过后端接口获取 markdown 预览内容；
 * 2) 使用 react-markdown + GFM 进行渲染；
 * 3) 对链接/图片做安全协议校验；
 * 4) 对 mermaid 代码块交由 MermaidDiagram 组件渲染。
 */
import React from 'react';
import { Alert, Spin, message } from 'antd';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import GithubSlugger from 'github-slugger';
import type { PluggableList } from 'unified';
import type { CommentAnchor, DiffFile, MarkdownPreview, ReviewThread } from '../../../shared/types';
import { fetchMarkdownPreview } from '../../api/content';
import styles from './index.module.less';
import { CommentPopover } from '../CommentPopover';
import { useReviewActions, useReviewNavigationActions } from '../../contexts/ReviewActionsContext';
import { readSelection, rehypeSelectionSource, type SelectionAnchor } from './selection';
import { MarkdownCommentBlock } from '../MarkdownCommentBlock';
import { MermaidDiagram } from '../MermaidDiagram';
import {
  extractText,
  findMarkdownAnchor,
  getCodeClassNameFromHast,
  getCodeTextFromHast,
  getHeadingSpacingClass,
  isBlockquoteLine,
  isNestedListLine,
  getMarkdownLineText,
  getMarkdownScrollLine,
  getNodeStartLine,
  getFirstFileThread,
  getPreviewThreadLine,
  isListItemHeadingLine,
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
  previewData?: MarkdownPreview;
  remoteAssetsOnly?: boolean;
  preserveUrlFragment?: boolean;
  interactionMode?: 'default' | 'shared-reviewer';
};

type MarkdownAstNode = {
  type?: string;
  value?: string;
  children?: MarkdownAstNode[];
};

const MARKDOWN_HIGHLIGHT_PATTERN = /==(.+?)==/g;

// 将 ==高亮== 这种轻量扩展语法转换成 mark 标签。
// 只处理 markdown 已解析出的普通 text 节点，避免影响 code、html 等语义节点。
function remarkMarkHighlight() {
  return (tree: MarkdownAstNode) => {
    transformHighlightSyntax(tree);
  };
}

function transformHighlightSyntax(node: MarkdownAstNode) {
  if (!node.children) return;

  node.children = node.children.flatMap((child) => {
    if (child.type !== 'text' || typeof child.value !== 'string') {
      transformHighlightSyntax(child);
      return [child];
    }

    return splitHighlightText(child.value);
  });
}

function splitHighlightText(value: string): MarkdownAstNode[] {
  const nodes: MarkdownAstNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(MARKDOWN_HIGHLIGHT_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, matchIndex) });
    }

    nodes.push(
      { type: 'html', value: '<mark>' },
      { type: 'text', value: match[1] },
      { type: 'html', value: '</mark>' }
    );
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex === 0) return [{ type: 'text', value }];
  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return nodes;
}

const MARKDOWN_REMARK_PLUGINS: PluggableList = [remarkFrontmatter, remarkGfm, remarkMarkHighlight];
const MARKDOWN_REHYPE_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'mark'
  ]
};
const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_REHYPE_SANITIZE_SCHEMA],
  rehypeSelectionSource
];
const MARKDOWN_SELECTION_HIGHLIGHT_NAME = 'diff-review-markdown-selection';
const MARKDOWN_SELECTION_HIGHLIGHT_STYLE_ID = 'diff-review-markdown-selection-style';

type HighlightConstructor = new (...ranges: Range[]) => unknown;
type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

function getCommentBlockContent(block: HTMLElement) {
  return block.querySelector<HTMLElement>('[data-markdown-comment-content]');
}

function getHighlightApi() {
  const HighlightValue = (window as Window & { Highlight?: HighlightConstructor }).Highlight;
  const highlights = (CSS as typeof CSS & { highlights?: HighlightRegistry }).highlights;
  if (!HighlightValue || !highlights) return null;
  ensureSelectionHighlightStyle();
  return { HighlightValue, highlights };
}

function ensureSelectionHighlightStyle() {
  if (document.getElementById(MARKDOWN_SELECTION_HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MARKDOWN_SELECTION_HIGHLIGHT_STYLE_ID;
  style.textContent = `::highlight(${MARKDOWN_SELECTION_HIGHLIGHT_NAME}), ::highlight(diff-review-markdown-active-selection) { background: #fff9e6; text-decoration: underline #e8bd00 2px; }`;
  document.head.appendChild(style);
}

function findTextPosition(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let lastTextNode: Text | null = null;

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    lastTextNode = textNode;
    if (remaining <= textNode.data.length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= textNode.data.length;
  }

  return lastTextNode ? { node: lastTextNode, offset: lastTextNode.data.length } : null;
}

function createHighlightRange(markdownBody: HTMLElement, anchor: Extract<CommentAnchor, { type: 'markdown-selection' }>) {
  const startBlock = markdownBody.querySelector<HTMLElement>(`[data-review-line="${anchor.startLine}"]`);
  const endBlock = markdownBody.querySelector<HTMLElement>(`[data-review-line="${anchor.endLine}"]`);
  const startContent = startBlock ? getCommentBlockContent(startBlock) : null;
  const endContent = endBlock ? getCommentBlockContent(endBlock) : null;
  if (!startContent || !endContent) return null;

  const start = findTextPosition(startContent, anchor.startOffset);
  const end = findTextPosition(endContent, anchor.endOffset);
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range.collapsed ? null : range;
}

// 选区高亮由 CSS Highlight API 绘制，没有可直接绑定事件的 DOM，统一通过文字范围做指针命中。
function findSelectionThreadAtPoint(
  markdownBody: HTMLElement,
  threads: ReviewThread[],
  filePath: string,
  clientX: number,
  clientY: number
) {
  for (const thread of threads) {
    if (thread.filePath !== filePath || thread.anchor.type !== 'markdown-selection') continue;
    const range = createHighlightRange(markdownBody, thread.anchor);
    const hit = range && [...range.getClientRects()].some((rect) =>
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
    if (hit) return thread;
  }
  return null;
}

function getAnchorPreviewLine(anchor: CommentAnchor) {
  if (anchor.type === 'markdown-selection') return anchor.startLine;
  if (anchor.type === 'markdown-line') return anchor.lineNumber;
  if (anchor.type === 'diff-line' && anchor.side === 'new') return anchor.lineNumber;
  return null;
}

export function MarkdownPreviewPanel({
  file,
  threads,
  locateTarget,
  previewData,
  remoteAssetsOnly = false,
  preserveUrlFragment = false,
  interactionMode = 'default'
}: Props) {
  const [preview, setPreview] = React.useState<MarkdownPreview | null>(previewData ?? null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const markdownBodyRef = React.useRef<HTMLDivElement | null>(null);
  const autoScrollKeyRef = React.useRef('');
  const { createThread } = useReviewActions();
  const { locateThread } = useReviewNavigationActions();
  const selectionGestureRef = React.useRef(false);
  const selectionComposerRef = React.useRef<HTMLDivElement | null>(null);
  const [selectionDraft, setSelectionDraft] = React.useState<{
    anchor: SelectionAnchor; range: Range; top: number; left: number;
  } | null>(null);

  React.useEffect(() => { setSelectionDraft(null); }, [file.path, preview]);

  React.useLayoutEffect(() => {
    if (!selectionDraft) return;
    const popover = selectionComposerRef.current?.firstElementChild;
    popover?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    selectionComposerRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [selectionDraft]);

  // 仅在 Shift 拖选结束后打开输入框，普通拖选继续使用浏览器复制手势。
  const captureSelection = React.useCallback(() => {
    const isCommentGesture = selectionGestureRef.current;
    selectionGestureRef.current = false;
    markdownBodyRef.current?.classList.remove(styles.commentSelection);
    if (!isCommentGesture) return;
    if (selectionDraft) return;
    const selection = window.getSelection();
    const body = markdownBodyRef.current;
    const shell = scrollRef.current;
    if (!selection?.rangeCount || !body || !shell) return;
    const range = selection.getRangeAt(0).cloneRange();
    const anchor = readSelection(body, range, file.path);
    if (typeof anchor === 'string') { message.info(anchor); return; }
    if (!anchor) return;
    const rect = [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    setSelectionDraft({
      anchor, range,
      top: rect.bottom - shellRect.top + shell.scrollTop + 8,
      left: Math.max(8, Math.min(rect.left - shellRect.left, shell.clientWidth - 324)) + shell.scrollLeft
    });
    selection.removeAllRanges();
  }, [file.path, selectionDraft]);

  // 浏览器原生 ::selection 不支持可靠的下划线，拖选期间叠加 Custom Highlight。
  React.useEffect(() => {
    const api = getHighlightApi();
    if (!api) return;
    const name = 'diff-review-markdown-active-selection';
    function update() {
      const selection = window.getSelection();
      const body = markdownBodyRef.current;
      if (selectionGestureRef.current && selection?.rangeCount && !selection.isCollapsed && body?.contains(selection.anchorNode) && body.contains(selection.focusNode)) {
        api!.highlights.set(name, new api!.HighlightValue(selection.getRangeAt(0).cloneRange()));
      } else {
        api!.highlights.delete(name);
      }
    }
    document.addEventListener('selectionchange', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      api.highlights.delete(name);
    };
  }, [file.path]);

  React.useEffect(() => {
    const cancel = () => {
      selectionGestureRef.current = false;
      markdownBodyRef.current?.classList.remove(styles.commentSelection);
    };
    document.addEventListener('pointerup', captureSelection);
    document.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('pointerup', captureSelection);
      document.removeEventListener('pointercancel', cancel);
    };
  }, [captureSelection]);


  React.useEffect(() => {
    if (previewData) {
      setPreview(previewData);
      return;
    }
    setPreview(null);
    fetchMarkdownPreview(file.path)
      .then((data) => setPreview(data))
      .catch(() => setPreview(null));
  }, [file.path, previewData]);

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

    const anchorLine = getAnchorPreviewLine(locateTarget.anchor);
    if (!anchorLine) return;

    const scrollLine = getMarkdownScrollLine(preview, anchorLine);
    const target = scrollContainer.querySelector<HTMLElement>(`[data-review-line="${scrollLine}"]`) ?? findMarkdownAnchor(scrollContainer, scrollLine);
    if (target) {
      scrollToTarget(scrollContainer, target);
    } else {
      scrollToContentTop(scrollContainer);
    }
  }, [file.path, locateTarget, preview]);

  const lineThreadsByLine = React.useMemo(() => {
    const nextLineThreadsByLine = new Map<number, ReviewThread[]>();
    for (const thread of threads) {
      if (thread.anchor.filePath !== file.path || thread.anchor.type === 'markdown-selection' || !preview) continue;
      const displayLineNumber = getPreviewThreadLine(preview, thread);
      if (!displayLineNumber) continue;
      const lineThreads = nextLineThreadsByLine.get(displayLineNumber) ?? [];
      lineThreads.push(thread);
      nextLineThreadsByLine.set(displayLineNumber, lineThreads);
    }
    return nextLineThreadsByLine;
  }, [file.path, preview, threads]);

  React.useEffect(() => {
    const markdownBody = markdownBodyRef.current;
    const highlightApi = getHighlightApi();
    if (!markdownBody || !highlightApi) return undefined;

    const ranges = threads
      .filter((thread) => thread.filePath === file.path && thread.anchor.type === 'markdown-selection')
      .map((thread) => createHighlightRange(markdownBody, thread.anchor as Extract<CommentAnchor, { type: 'markdown-selection' }>))
      .filter((range): range is Range => Boolean(range));

    if (selectionDraft) ranges.push(selectionDraft.range);

    if (ranges.length > 0) {
      highlightApi.highlights.set(MARKDOWN_SELECTION_HIGHLIGHT_NAME, new highlightApi.HighlightValue(...ranges));
    } else {
      highlightApi.highlights.delete(MARKDOWN_SELECTION_HIGHLIGHT_NAME);
    }

    return () => {
      highlightApi.highlights.delete(MARKDOWN_SELECTION_HIGHLIGHT_NAME);
    };
  }, [file.path, preview, threads, selectionDraft]);

  // 所有块级评论入口都尽量统一走这一层包装。
  // 例外是 blockquote 内部的段落/列表：外层 blockquote 已经可评论时，内部块会跳过包装，避免重复入口。
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
        lineThreads={lineThreadsByLine.get(lineNumber) ?? []}
        className={options?.className}
        interactionMode={interactionMode}
      >
        {content}
      </MarkdownCommentBlock>
    );
  }, [file.path, interactionMode, lineThreadsByLine]);

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
    const heading = React.createElement(
      Tag,
      {
        ...props,
        className: joinClassNames(props.className, styles.markdownHeading),
        style: { ...props.style, ...extraStyle, marginTop: 0 }
      },
      children
    );

    if (preview && isListItemHeadingLine(preview.content, lineNumber)) {
      return heading;
    }

    return renderCommentableBlock(
      lineNumber,
      heading,
      { className: getHeadingSpacingClass(level) }
    );
  }, [preview, renderCommentableBlock]);

  // 分享页的 URL Fragment 承载完整快照，页内链接改为直接滚动，避免浏览器覆盖分享数据。
  const handleInternalLinkClick = React.useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!preserveUrlFragment || !href.startsWith('#')) return;
    event.preventDefault();

    const scrollContainer = scrollRef.current;
    const markdownBody = markdownBodyRef.current;
    if (!scrollContainer || !markdownBody) return;

    let anchorName = href.slice(1);
    try {
      anchorName = decodeURIComponent(anchorName);
    } catch {
      return;
    }

    const explicitTarget = [...markdownBody.querySelectorAll<HTMLElement>('[id], [name]')]
      .find((element) => element.id === anchorName || element.getAttribute('name') === anchorName);
    const slugger = new GithubSlugger();
    const target = explicitTarget ?? [...markdownBody.querySelectorAll<HTMLHeadingElement>('h1, h2, h3, h4, h5, h6')]
      .find((heading) => slugger.slug(heading.textContent ?? '') === anchorName);
    if (target) scrollToTarget(scrollContainer, target);
  }, [preserveUrlFragment]);

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
      if (preview && /^(?:\s*([-*+]|\d+[.)])\s+)/.test(getMarkdownLineText(preview.content, getNodeStartLine(node)))) {
        return <p {...props}>{children}</p>;
      }
      if (preview && isBlockquoteLine(preview.content, getNodeStartLine(node))) {
        return <p {...props}>{children}</p>;
      }
      return renderCommentableBlock(getNodeStartLine(node), <p {...props}>{children}</p>);
    },
    ul({ children, node, ...props }) {
      if (preview && (isBlockquoteLine(preview.content, getNodeStartLine(node)) || isNestedListLine(preview.content, getNodeStartLine(node)))) {
        return <ul {...props}>{children}</ul>;
      }
      return renderCommentableBlock(getNodeStartLine(node), <ul {...props}>{children}</ul>);
    },
    ol({ children, node, ...props }) {
      if (preview && (isBlockquoteLine(preview.content, getNodeStartLine(node)) || isNestedListLine(preview.content, getNodeStartLine(node)))) {
        return <ol {...props}>{children}</ol>;
      }
      return renderCommentableBlock(getNodeStartLine(node), <ol {...props}>{children}</ol>);
    },
    li({ children, node: _node, ...props }) {
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
    code({ className, children, node: _node, ...props }) {
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
    a({ href, children, node: _node, ...props }) {
      const safeHref = href ?? '';

      if (!safeHref || !isSafeUrl(safeHref)) {
        return <span>{children}</span>;
      }

      const isExternal = /^https?:/i.test(safeHref);
      return (
        <a
          href={safeHref}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer' : undefined}
          {...props}
          onClick={(event) => handleInternalLinkClick(event, safeHref)}
        >
          {children}
        </a>
      );
    },
    // 图片地址仅在通过安全校验后渲染，并启用懒加载。
    img({ src, alt, node: _node, ...props }) {
      const safeSrc = src ?? '';

      if (!safeSrc || !isSafeUrl(safeSrc)) {
        return null;
      }

      if (remoteAssetsOnly && !/^https?:/i.test(safeSrc)) {
        return <span title={safeSrc}>[本地图片未包含在分享链接中：{alt || safeSrc}]</span>;
      }

      const resolvedSrc = remoteAssetsOnly ? safeSrc : resolveAssetPath(file.path, safeSrc);
      return (
        <img src={resolvedSrc} alt={alt ?? ''} loading="lazy" {...props} />
      );
    }
  }), [file.path, handleInternalLinkClick, preview, remoteAssetsOnly, renderCommentableBlock, renderCommentableHeading]);

  // preview 为 null 时，当前 UI 统一展示 loading 态；加载失败也沿用这一视觉占位。
  if (!preview) {
    return (
      <div className={styles.markdownLoading}>
        <Spin />
      </div>
    );
  }

  return (
    <div className={styles.markdownShell} ref={scrollRef}
      onPointerDown={(event) => {
        selectionGestureRef.current = event.button === 0 && event.shiftKey && Boolean(markdownBodyRef.current?.contains(event.target as Node));
        markdownBodyRef.current?.classList.toggle(styles.commentSelection, selectionGestureRef.current);
        if (selectionGestureRef.current) window.getSelection()?.removeAllRanges();
      }}
      onKeyDown={(event) => { if (event.key === 'Escape') setSelectionDraft(null); }}>
      {selectionDraft ? (
        <div data-review-ignore-selection ref={selectionComposerRef}>
          <CommentPopover
            style={{ top: selectionDraft.top, left: selectionDraft.left, right: 'auto', maxWidth: 'calc(100% - 16px)' }}
            selectedText={selectionDraft.anchor.selectedText}
            onCancel={() => setSelectionDraft(null)}
            onSubmit={async (body) => {
              await createThread(selectionDraft.anchor, body);
              setSelectionDraft(null);
            }}
          />
        </div>
      ) : null}
      {preview.deleted ? <Alert className={styles.deletedBanner} message="该文件已删除，仅展示删除前预览" type="warning" showIcon /> : null}
      <article className={styles.markdownArticle}>
        <div className={styles.markdownBody} ref={markdownBodyRef}
          onPointerMove={(event) => {
            const body = markdownBodyRef.current;
            if (!body || selectionGestureRef.current) return;
            const hoveredThread = findSelectionThreadAtPoint(body, threads, file.path, event.clientX, event.clientY);
            body.classList.toggle(styles.selectionHighlightHover, Boolean(hoveredThread));
          }}
          onPointerLeave={() => markdownBodyRef.current?.classList.remove(styles.selectionHighlightHover)}
          onClick={(event) => {
            if (event.shiftKey || selectionDraft || !window.getSelection()?.isCollapsed) return;
            const body = markdownBodyRef.current;
            if (!body) return;
            const thread = findSelectionThreadAtPoint(body, threads, file.path, event.clientX, event.clientY);
            if (thread) {
              event.preventDefault();
              locateThread(thread.id);
            }
          }}>
          <ReactMarkdown
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            urlTransform={(url) => (isSafeUrl(url) ? url : '')}
            components={markdownComponents}
          >
            {preview.content}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
