/**
 * Prompt 格式化工具：负责把评论线程整理成稳定的纯文本提示词，供复制到外部 Agent 或模型上下文中。
 */
import type { ReviewComment, ReviewThread } from '../shared/types';

export function formatPrompt(threads: ReviewThread[]): string {
  const threadPrompt = threads
    .map((thread) => {
      const location = getThreadLocation(thread);
      const [firstComment, ...replies] = thread.comments;
      const replyText = replies
        .map((comment, index) => {
          const author = comment.author === 'agent'
            ? 'Agent'
            : comment.author === 'reviewer'
              ? `Reviewer: ${comment.authorName || 'Unknown'}`
              : 'User';
          return `Reply ${index + 1} (${author})\n${formatCommentContent(comment)}`;
        })
        .join('\n');

      return [`[thread:${thread.id}]`, location, getSelectedTextLine(thread), formatFirstComment(firstComment), replyText].filter(Boolean).join('\n');
    })
    .join('\n\n');

  const imageInstruction = threads.some((thread) => thread.comments.some((comment) => comment.attachments?.length))
    ? 'Attached images: use an image-reading tool to view every listed local file. Each image belongs to the comment or reply immediately above its attachment list.\n\n' : '';
  if (!threads.some((thread) => thread.anchor.type === 'markdown-selection')) return imageInstruction + threadPrompt;
  return imageInstruction + `Markdown selections: \`Selected (JSON)\` contains rendered text. Locate it within the source lines shown for that thread; Markdown syntax may interrupt the text. Edit only the selected content.\n\n${threadPrompt}`;
}

function formatFirstComment(comment: ReviewThread['comments'][number] | undefined) {
  if (!comment) return '';
  const author = comment.author === 'reviewer' ? `[Reviewer: ${comment.authorName || 'Unknown'}]\n` : '';
  return `${author}${formatCommentContent(comment)}`;
}

// 附件紧跟所属评论或回复，批量复制时保留归属；JSON 字符串避免文件名和路径中的换行破坏格式。
function formatCommentContent(comment: ReviewComment): string {
  const images = comment.attachments?.length
    ? ['Attached images:', ...comment.attachments.map((image) => `- ${JSON.stringify(image.name)}: ${JSON.stringify(image.path)}`)].join('\n') : '';
  return [comment.body.trim(), images].filter(Boolean).join('\n');
}

function getThreadLocation(thread: ReviewThread) {
  if (thread.anchor.type === 'file') return thread.filePath;
  if (thread.anchor.type === 'diff-line') return `${thread.filePath}:${thread.anchor.side}:${thread.anchor.lineNumber}`;
  if (thread.anchor.type === 'markdown-selection') return `${thread.filePath}:${formatLineRange(thread.anchor.sourceStartLine ?? thread.anchor.startLine, thread.anchor.sourceEndLine ?? thread.anchor.endLine)}`;
  return `${thread.filePath}:${thread.anchor.lineNumber}`;
}

function getSelectedTextLine(thread: ReviewThread) {
  if (thread.anchor.type !== 'markdown-selection') return '';
  const { selectedText, tableColumn } = thread.anchor;
  return [`Selected (JSON): ${JSON.stringify(selectedText)}`, tableColumn ? `Table column: ${tableColumn}` : ''].filter(Boolean).join('\n');
}

function formatLineRange(startLine: number, endLine: number) {
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
}
