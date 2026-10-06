/**
 * Markdown 选区定位：保留渲染文本的源码行范围，并将 DOM 选区转换为可恢复的评论锚点。
 * 块内偏移用于预览高亮，源码行与表格列用于 Agent 定位，两者独立保存。
 */
import type { Root, Element as HastElement } from 'hast';
import type { CommentAnchor } from '../../../shared/types';

export type SelectionAnchor = Extract<CommentAnchor, { type: 'markdown-selection' }>;

// 在 sanitize 之后添加可信的位置标记，保持原有 Markdown 元素结构。
export function rehypeSelectionSource() {
  return (tree: Root) => {
    function visit(node: Root | HastElement) {
      if (node.type === 'element' && node.position) {
        node.properties['data-source-start'] = node.position.start.line;
        node.properties['data-source-end'] = node.position.end.line;
      }
      for (const child of node.children) {
        if (child.type === 'element') visit(child);
      }
    }
    visit(tree);
  };
}

// 只有渲染文本与源码换行数量一致时才细化到端点所在行；折叠换行的行内代码保留可靠范围。
function sourceLine(element: HTMLElement, node: Node, offset: number, end: boolean) {
  const startLine = Number(element.dataset.sourceStart);
  const endLine = Number(element.dataset.sourceEnd);
  const text = element.textContent ?? '';
  if (text.split('\n').length - 1 !== endLine - startLine) return end ? endLine : startLine;
  const prefix = document.createRange();
  prefix.selectNodeContents(element);
  prefix.setEnd(node, offset);
  const value = prefix.toString();
  return startLine + (end ? value.replace(/\n$/, '') : value).split('\n').length - 1;
}

// 只接收纯正文选区；跨表格单元格及包含非文本控件的选区保留复制能力，但不创建评论。
export function readSelection(body: HTMLElement, range: Range, filePath: string): SelectionAnchor | string | null {
  const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement;
  if (!(startElement instanceof HTMLElement) || !(endElement instanceof HTMLElement) ||
    !body.contains(startElement) || !body.contains(endElement) || range.collapsed || !range.toString().trim()) return null;
  const startContent = startElement.closest<HTMLElement>('[data-markdown-comment-content]');
  const endContent = endElement.closest<HTMLElement>('[data-markdown-comment-content]');
  if (!startContent || !endContent) return null;
  const startCell = startElement.closest('td, th');
  const endCell = endElement.closest('td, th');
  if (startCell !== endCell || (!startCell && [...body.querySelectorAll('table')].some((node) => range.intersectsNode(node)))) {
    return '区域评论仅支持单个表格单元格内的文字；跨单元格请使用整表评论。';
  }
  if ([...body.querySelectorAll('[data-review-ignore-selection]:not(button), [data-markdown-comment-content] img, [data-markdown-comment-content] svg, textarea, input')]
    .some((node) => range.intersectsNode(node))) return '该选区包含控件或图片，请缩小文字选区，或使用块级评论。';
  const startSource = startElement.closest<HTMLElement>('[data-source-start]');
  const endSource = endElement.closest<HTMLElement>('[data-source-start]');
  if (!startSource || !endSource) return '这部分内容无法可靠映射源码，请使用块级评论。';
  const startPrefix = document.createRange();
  startPrefix.selectNodeContents(startContent);
  startPrefix.setEnd(range.startContainer, range.startOffset);
  const endPrefix = document.createRange();
  endPrefix.selectNodeContents(endContent);
  endPrefix.setEnd(range.endContainer, range.endOffset);
  return {
    type: 'markdown-selection', filePath,
    startLine: Number(startContent.parentElement?.dataset.reviewLine),
    endLine: Number(endContent.parentElement?.dataset.reviewLine),
    startOffset: startPrefix.toString().length, endOffset: endPrefix.toString().length,
    selectedText: range.toString(),
    sourceStartLine: sourceLine(startSource, range.startContainer, range.startOffset, false),
    sourceEndLine: sourceLine(endSource, range.endContainer, range.endOffset, true),
    ...(startCell ? { tableColumn: (startCell as HTMLTableCellElement).cellIndex + 1 } : {})
  };
}
