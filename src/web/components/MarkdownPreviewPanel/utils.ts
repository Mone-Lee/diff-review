/**
 * Markdown 预览辅助工具：负责评论定位、滚动锚点、HAST 代码块信息提取与预览层安全展示判断。
 */
import React from 'react';
import type { MarkdownPreview, ReviewThread } from '../../../shared/types';
import { buildMarkdownAssetUrl } from '../../api/content';
import styles from './index.module.less';

export type HastNode = {
  tagName?: string;
  type?: string;
  value?: string;
  position?: { start?: { line?: number } };
  properties?: { className?: unknown };
  children?: HastNode[];
};

/**
 * codediff 里评论的锚点排序规则：
 * 文件级评论：不映射
 * old 侧行评论：不在 Preview 挂载
 * new 侧行评论：按它的源码行号，找出所属 Markdown block，并返回该 block 的 startLine
 */
function threadAnchorOrder(thread: ReviewThread) {
  if (thread.anchor.type === 'file') return 0;
  if (thread.anchor.type === 'markdown-line') return thread.anchor.lineNumber;
  if (thread.anchor.type === 'markdown-selection') return thread.anchor.startLine;
  if (thread.anchor.type === 'diff-line' && thread.anchor.side === 'new') return thread.anchor.lineNumber;
  return Number.MAX_SAFE_INTEGER;
}

export function getFirstFileThread(filePath: string, threads: ReviewThread[]) {
  return threads
    .filter((thread) => thread.filePath === filePath && thread.status !== 'resolved')
    .sort((left, right) => threadAnchorOrder(left) - threadAnchorOrder(right) || left.createdAt.localeCompare(right.createdAt))[0];
}

export function scrollToContentTop(scrollContainer: HTMLElement) {
  scrollContainer.scrollTop = 0;
}

export function scrollToTarget(scrollContainer: HTMLElement, target: HTMLElement) {
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  scrollContainer.scrollTop += targetRect.top - containerRect.top;
}

export function findMarkdownAnchor(scrollContainer: HTMLElement, lineNumber: number) {
  const anchors = [...scrollContainer.querySelectorAll<HTMLElement>('[data-review-line]')];
  const previousAnchors = anchors.filter((anchor) => Number(anchor.dataset.reviewLine) <= lineNumber);
  return previousAnchors.at(-1) ?? anchors.find((anchor) => Number(anchor.dataset.reviewLine) >= lineNumber) ?? null;
}

export function getMarkdownScrollLine(preview: MarkdownPreview, lineNumber: number) {
  const containingBlock = preview.blocks.find((block) => lineNumber >= block.startLine && lineNumber <= block.endLine);
  if (containingBlock) return containingBlock.startLine;

  const nextBlock = preview.blocks.find((block) => block.startLine >= lineNumber);
  return nextBlock?.startLine ?? preview.blocks.at(-1)?.startLine ?? lineNumber;
}

export function getPreviewThreadLine(preview: MarkdownPreview, thread: ReviewThread) {
  if (thread.anchor.type === 'file') return null;
  if (thread.anchor.type === 'diff-line' && thread.anchor.side !== 'new') return null;
  const lineNumber = getThreadPreviewStartLine(thread);
  return lineNumber ? getMarkdownScrollLine(preview, lineNumber) : null;
}

export function getThreadPreviewStartLine(thread: ReviewThread) {
  if (thread.anchor.type === 'markdown-selection') return thread.anchor.startLine;
  if (thread.anchor.type === 'markdown-line') return thread.anchor.lineNumber;
  if (thread.anchor.type === 'diff-line' && thread.anchor.side === 'new') return thread.anchor.lineNumber;
  return null;
}

// 仅允许常见安全协议与站内相对路径，拦截 javascript: 等危险链接。
export function isSafeUrl(url: string) {
  return /^(https?:|mailto:|#|\.{0,2}\/|\/)/i.test(url.trim());
}

export function resolveAssetPath(markdownPath: string, rawUrl: string) {
  return buildMarkdownAssetUrl(markdownPath, rawUrl);
}

// 从 ReactNode 递归提取纯文本，用于读取 code/pre 的真实文本内容。
export function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

// 统一 className 形态（string 或 string[]），便于后续解析 language-xxx。
export function getClassName(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').join(' ');
  return typeof value === 'string' ? value : '';
}

// 判断节点是否可作为代码节点处理（含 className 或 children）。
export function isElementWithCodeProps(node: React.ReactNode): node is React.ReactElement<{ className?: string; children?: React.ReactNode }> {
  return React.isValidElement<{ className?: string; children?: React.ReactNode }>(node) && Boolean(node.props.className || node.props.children);
}

export function getNodeStartLine(node: unknown): number | undefined {
  const line = (node as HastNode | undefined)?.position?.start?.line;
  return typeof line === 'number' ? line : undefined;
}

// 从 HAST 的 pre > code 节点中提取 className。
export function getCodeClassNameFromHast(node: unknown) {
  const maybePre = node as HastNode | undefined;
  const codeNode = maybePre?.children?.find((child) => child.tagName === 'code');
  return getClassName(codeNode?.properties?.className);
}

// 从 HAST 结构递归拼接文本，作为 ReactNode 提取失败时的兜底。
export function extractTextFromHast(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return node.children?.map(extractTextFromHast).join('') ?? '';
}

// 从 HAST 的 pre > code 中读取源码文本。
export function getCodeTextFromHast(node: unknown) {
  const maybePre = node as HastNode | undefined;
  const codeNode = maybePre?.children?.find((child) => child.tagName === 'code');
  return extractTextFromHast(codeNode);
}

// 读取指定行原始 markdown，用来识别 blockquote 这类“外层块已可评论”的场景。
// 这样可以避免继续给引用块里的每个段落再包一层评论入口，减少重复入口。
export function getMarkdownLineText(markdown: string, lineNumber: number | undefined) {
  if (!lineNumber) return '';
  return markdown.split(/\r?\n/)[lineNumber - 1] ?? '';
}

// 判断当前标题是否写在列表项标记后面，例如 `- ### title`。
// 这种内容已经由外层列表承载评论入口，标题自身不再额外生成入口。
export function isListItemHeadingLine(markdown: string, lineNumber: number | undefined) {
  return /^(?:\s*(?:[-*+]|\d+[.)])\s+)#{1,6}(?:\s|$)/.test(getMarkdownLineText(markdown, lineNumber));
}

// 判断当前节点对应的源码行是否仍处于 blockquote 语法中。
// 这类内容已经由外层引用块承载评论入口，内部段落/列表不应再重复挂评论按钮。
export function isBlockquoteLine(markdown: string, lineNumber: number | undefined) {
  return /^\s*>/.test(getMarkdownLineText(markdown, lineNumber));
}

// 判断当前列表节点是否是缩进后的嵌套列表。
// 嵌套列表的评论应归属最外层 list block，避免外层列表与内层列表同时出现入口。
export function isNestedListLine(markdown: string, lineNumber: number | undefined) {
  return /^\s{2,}(?:[-*+]|\d+[.)])\s+/.test(getMarkdownLineText(markdown, lineNumber));
}

export function joinClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter(Boolean).join(' ');
}

// 标题顶部留白不再交给 h1-h6 自己的 margin-top 处理，而是交给评论容器负责。
// 这样评论 icon 就能稳定贴着标题文本顶部，而不会因为 heading margin 塌陷/外溢出现错位。
export function getHeadingSpacingClass(level: 1 | 2 | 3 | 4 | 5 | 6) {
  if (level === 1) return undefined;
  if (level === 2) return styles.commentBlockSpacingLg;
  return styles.commentBlockSpacingMd;
}
