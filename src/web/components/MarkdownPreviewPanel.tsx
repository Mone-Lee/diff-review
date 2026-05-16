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
import { MessageOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { CommentAnchor, DiffFile, MarkdownPreview, ReviewThread } from '../../shared/types';
import styles from '../styles.module.less';
import { CommentPopover } from './CommentPopover';
import { InlineThreadCard } from './InlineThreadCard';
import { MermaidDiagram } from './MermaidDiagram';

type Props = {
  file: DiffFile;
  threads: ReviewThread[];
  onCreate: (anchor: CommentAnchor, body: string) => Promise<void>;
  onLocateThread: (threadId: string) => void;
  onPatchThread: (id: string, status: ReviewThread['status']) => Promise<void>;
  onDeleteThread: (id: string) => Promise<void>;
  onReplyThread: (id: string, body: string) => Promise<void>;
  onPatchComment: (threadId: string, commentId: string, body: string) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onCopyThread: (scope: { type: 'thread'; threadId: string }) => Promise<void>;
};

function isSafeUrl(url: string) {
  // 仅允许常见安全协议与站内相对路径，拦截 javascript: 等危险链接。
  return /^(https?:|mailto:|#|\.{0,2}\/|\/)/i.test(url.trim());
}

function extractText(node: React.ReactNode): string {
  // 从 ReactNode 递归提取纯文本，用于读取 code/pre 的真实文本内容。
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

function getClassName(value: unknown) {
  // 统一 className 形态（string 或 string[]），便于后续解析 language-xxx。
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(' ');
  return typeof value === 'string' ? value : '';
}

function isElementWithCodeProps(node: React.ReactNode): node is React.ReactElement<{ className?: string; children?: React.ReactNode }> {
  // 判断节点是否可作为代码节点处理（含 className 或 children）。
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

function getCodeClassNameFromHast(node: unknown) {
  // 从 HAST 的 pre > code 节点中提取 className。
  const maybePre = node as HastNode | undefined;
  const codeNode = maybePre?.children?.find((child) => child.tagName === 'code');
  return getClassName(codeNode?.properties?.className);
}

function extractTextFromHast(node: HastNode | undefined): string {
  // 从 HAST 结构递归拼接文本，作为 ReactNode 提取失败时的兜底。
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return node.children?.map(extractTextFromHast).join('') ?? '';
}

function getCodeTextFromHast(node: unknown) {
  // 从 HAST 的 pre > code 中读取源码文本。
  const maybePre = node as HastNode | undefined;
  const codeNode = maybePre?.children?.find((child) => child.tagName === 'code');
  return extractTextFromHast(codeNode);
}

export function MarkdownPreviewPanel({
  file,
  threads,
  onCreate,
  onLocateThread,
  onPatchThread,
  onDeleteThread,
  onReplyThread,
  onPatchComment,
  onDeleteComment,
  onCopyThread
}: Props) {
  // preview 为 null 表示加载中或加载失败；当前 UI 统一展示 loading 态。
  const [preview, setPreview] = React.useState<MarkdownPreview | null>(null);
  const [activeLine, setActiveLine] = React.useState<number | null>(null);

  React.useEffect(() => {
    // 文件切换时重新拉取预览内容，确保右侧展示与当前文件同步。
    setPreview(null);
    setActiveLine(null);
    fetch(`/api/markdown-preview?path=${encodeURIComponent(file.path)}`)
      .then((res) => res.json())
      .then((data: MarkdownPreview) => setPreview(data))
      .catch(() => setPreview(null));
  }, [file.path]);

  function getMarkdownLineThreads(lineNumber: number) {
    return threads.filter(
      (thread) =>
        thread.anchor.type === 'markdown-line' &&
        thread.anchor.filePath === file.path &&
        thread.anchor.lineNumber === lineNumber
    );
  }

  function renderCommentableBlock(lineNumber: number | undefined, content: React.ReactNode) {
    if (!lineNumber) return content;
    const lineThreads = getMarkdownLineThreads(lineNumber);

    return (
      <div className={styles.markdownCommentBlock}>
        <div className={styles.markdownCommentContent}>{content}</div>
        {lineThreads.length === 0 ? (
          <button className={styles.commentTrigger} type="button" aria-label="添加行评论" onClick={() => setActiveLine(lineNumber)}>
            <MessageOutlined />
          </button>
        ) : null}
        {activeLine === lineNumber ? (
          <CommentPopover
            onCancel={() => setActiveLine(null)}
            onSubmit={async (body) => {
              await onCreate({ type: 'markdown-line', filePath: file.path, lineNumber, blockId: `line-${lineNumber}` }, body);
              setActiveLine(null);
            }}
          />
        ) : null}
        {lineThreads.length > 0 ? (
          <div className={styles.inlineThreadStack}>
            {lineThreads.map((thread) => (
              <InlineThreadCard
                key={thread.id}
                thread={thread}
                onFocus={onLocateThread}
                onPatch={onPatchThread}
                onDeleteThread={onDeleteThread}
                onReply={onReplyThread}
                onPatchComment={onPatchComment}
                onDeleteComment={onDeleteComment}
                onCopy={onCopyThread}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const markdownComponents: Components = {
    h1({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <h1 {...props}>{children}</h1>);
    },
    h2({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <h2 {...props}>{children}</h2>);
    },
    h3({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <h3 {...props}>{children}</h3>);
    },
    h4({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <h4 {...props}>{children}</h4>);
    },
    h5({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <h5 {...props}>{children}</h5>);
    },
    h6({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <h6 {...props}>{children}</h6>);
    },
    p({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <p {...props}>{children}</p>);
    },
    blockquote({ children, node, ...props }) {
      return renderCommentableBlock(getNodeStartLine(node), <blockquote {...props}>{children}</blockquote>);
    },
    pre({ children, node, ...props }) {
      // 自定义 pre：识别 mermaid 代码块并替换为图表组件，其余保持普通代码块渲染。
      const nodes = React.Children.toArray(children);
      const codeElement = nodes.find(isElementWithCodeProps);
      const codeText = extractText(codeElement ?? children) || getCodeTextFromHast(node);
      const codeClassName = codeElement?.props.className ?? getCodeClassNameFromHast(node);
      const language = /language-(\S+)/.exec(codeClassName)?.[1];
      const normalizedCodeText = codeText.replace(/\n$/, '');
      const lineNumber = getNodeStartLine(node);

      if (language === 'mermaid' && normalizedCodeText.trim()) {
        return renderCommentableBlock(lineNumber, <MermaidDiagram chart={normalizedCodeText} />);
      }

      return renderCommentableBlock(
        lineNumber,
        <pre className={styles.markdownPre} {...props}>
          {children}
        </pre>
      );
    },
    code({ className, children, node, ...props }) {
      // 行内 code 与代码块中的 code 分开样式处理。
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
    table({ children, node, ...props }) {
      // 表格包裹横向滚动容器，避免窄屏布局溢出。
      return renderCommentableBlock(
        getNodeStartLine(node),
        <div className={styles.markdownTableScroll}>
          <table {...props}>{children}</table>
        </div>
      );
    },
    a({ href, children, node, ...props }) {
      // 链接仅在通过安全校验后渲染；外链自动新开窗口。
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
    img({ src, alt, node, ...props }) {
      // 图片地址仅在通过安全校验后渲染，并启用懒加载。
      void node;
      const safeSrc = src ?? '';

      if (!safeSrc || !isSafeUrl(safeSrc)) {
        return null;
      }

      return (
        <img src={safeSrc} alt={alt ?? ''} loading="lazy" {...props} />
      );
    }
  };

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
          <ReactMarkdown remarkPlugins={[remarkFrontmatter, remarkGfm]} urlTransform={(url) => (isSafeUrl(url) ? url : '')} components={markdownComponents}>
            {preview.content}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  );
}
