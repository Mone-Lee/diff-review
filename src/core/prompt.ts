/**
 * Prompt 格式化工具：负责把评论线程整理成稳定的纯文本提示词，供复制到外部 Agent 或模型上下文中。
 */
import type { ReviewThread } from '../shared/types';

export function formatPrompt(threads: ReviewThread[]): string {
  return threads
    .map((thread) => {
      const location = getThreadLocation(thread);
      const [firstComment, ...replies] = thread.comments;
      const replyText = replies
        .map((comment, index) => {
          const author = comment.author === 'agent' ? 'Agent' : 'User';
          return `Reply ${index + 1} (${author})\n${comment.body.trim()}`;
        })
        .join('\n');

      return [`[thread:${thread.id}]`, location, getSelectedTextLine(thread), firstComment?.body.trim(), replyText].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function getThreadLocation(thread: ReviewThread) {
  if (thread.anchor.type === 'file') return thread.filePath;
  if (thread.anchor.type === 'diff-line') return `${thread.filePath}:${thread.anchor.side}:${thread.anchor.lineNumber}`;
  if (thread.anchor.type === 'markdown-selection') return `${thread.filePath}:${formatLineRange(thread.anchor.startLine, thread.anchor.endLine)}`;
  return `${thread.filePath}:${thread.anchor.lineNumber}`;
}

function getSelectedTextLine(thread: ReviewThread) {
  if (thread.anchor.type !== 'markdown-selection') return '';
  const selectedText = thread.anchor.selectedText.trim().replace(/\s+/g, ' ');
  return selectedText ? `Selected: ${selectedText}` : '';
}

function formatLineRange(startLine: number, endLine: number) {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}
