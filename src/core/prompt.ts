import type { ReviewThread } from '../shared/types';

export function formatPrompt(threads: ReviewThread[]): string {
  return threads
    .flatMap((thread) =>
      thread.comments.map((comment) => {
        const line = getAnchorLine(thread);
        const location = line ? `${thread.filePath}:${line}` : thread.filePath;
        return `${location}\n${comment.body.trim()}`;
      })
    )
    .join('\n\n');
}

function getAnchorLine(thread: ReviewThread): number | undefined {
  if (thread.anchor.type === 'file') return undefined;
  return thread.anchor.lineNumber;
}
