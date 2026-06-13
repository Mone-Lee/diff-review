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

      return [`[thread:${thread.id}]`, location, firstComment?.body.trim(), replyText].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function getThreadLocation(thread: ReviewThread) {
  if (thread.anchor.type === 'file') return thread.filePath;
  if (thread.anchor.type === 'diff-line') return `${thread.filePath}:${thread.anchor.side}:${thread.anchor.lineNumber}`;
  return `${thread.filePath}:${thread.anchor.lineNumber}`;
}
