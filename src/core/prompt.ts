import type { ReviewThread } from '../shared/types';

export function formatPrompt(threads: ReviewThread[]): string {
  return threads
    .map((thread) => {
      // 文件级评论不带行号，行级/块级评论带 file:line。
      const line = getAnchorLine(thread);
      const location = line ? `${thread.filePath}:${line}` : thread.filePath;
      const [firstComment, ...replies] = thread.comments;
      const replyText = replies
        .map((comment, index) => {
          const author = comment.author === 'agent' ? 'Agent' : 'User';
          return `Reply ${index + 1} (${author})\n${comment.body.trim()}`;
        })
        .join('\n');

      return [location, firstComment?.body.trim(), replyText].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function getAnchorLine(thread: ReviewThread): number | undefined {
  if (thread.anchor.type === 'file') return undefined;
  return thread.anchor.lineNumber;
}
