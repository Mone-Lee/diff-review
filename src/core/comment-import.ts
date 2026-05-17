import type { CommentAnchor, DiffFile, ReviewThread } from '../shared/types';
import { readComments, writeComments } from '../server/storage';
import { getOpenThreadStatus, sameAnchor } from '../shared/thread-utils';

type ImportPosition =
  | { side?: 'old' | 'new'; line?: number | { start: number; end?: number } }
  | { type: 'markdown'; line: number | { start: number; end?: number } };

type ImportThreadComment = {
  type: 'thread';
  filePath: string;
  body: string;
  position?: ImportPosition;
};

type ImportReplyComment = {
  type: 'reply';
  threadId: string;
  body: string;
};

type ImportComment = ImportThreadComment | ImportReplyComment;

export type ImportCommentsResult = {
  imported: number;
  skipped: string[];
};

export async function importAgentComments(repoRoot: string, diffFiles: DiffFile[], rawComments: string[]): Promise<ImportCommentsResult> {
  const result: ImportCommentsResult = { imported: 0, skipped: [] };
  if (rawComments.length === 0) return result;

  const store = await readComments(repoRoot);
  for (let index = 0; index < rawComments.length; index += 1) {
    const label = `--comment #${index + 1}`;
    const parsed = parseImportComment(rawComments[index], label, result);
    if (!parsed) continue;

    if (parsed.type === 'reply') {
      if (appendAgentReply(store.threads, parsed, result, label)) {
        result.imported += 1;
      }
      continue;
    }

    const thread = buildAgentThread(parsed, diffFiles, result, label);
    if (!thread) continue;
    const existingThread = store.threads.find((item) => sameAnchor(item.anchor, thread.anchor));
    if (hasDuplicateAgentComment(store.threads, thread)) {
      result.skipped.push(`${label}: duplicate agent comment skipped`);
      continue;
    }

    if (existingThread) {
      existingThread.comments.push(thread.comments[0]);
      existingThread.status = getOpenThreadStatus(existingThread);
      existingThread.updatedAt = thread.updatedAt;
    } else {
      store.threads.push(thread);
    }
    result.imported += 1;
  }

  if (result.imported > 0) {
    await writeComments(repoRoot, store);
  }
  return result;
}

function parseImportComment(raw: string, label: string, result: ImportCommentsResult): ImportComment | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    result.skipped.push(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }

  if (!isRecord(value)) {
    result.skipped.push(`${label}: comment must be a JSON object`);
    return undefined;
  }

  if (value.type === 'reply') {
    const threadId = stringField(value, 'threadId');
    const body = stringField(value, 'body')?.trim();
    if (!threadId || !body) {
      result.skipped.push(`${label}: reply comments require non-empty threadId and body`);
      return undefined;
    }
    return { type: 'reply', threadId, body };
  }

  if (value.type === 'thread') {
    const filePath = stringField(value, 'filePath');
    const body = stringField(value, 'body')?.trim();
    if (!filePath || !body) {
      result.skipped.push(`${label}: thread comments require non-empty filePath and body`);
      return undefined;
    }
    return { type: 'thread', filePath, body, position: parsePosition(value.position) };
  }

  result.skipped.push(`${label}: unsupported comment type`);
  return undefined;
}

function appendAgentReply(threads: ReviewThread[], comment: ImportReplyComment, result: ImportCommentsResult, label: string): boolean {
  const thread = threads.find((item) => item.id === comment.threadId);
  if (!thread) {
    result.skipped.push(`${label}: thread ${comment.threadId} was not found`);
    return false;
  }
  if (thread.comments.some((item) => item.author === 'agent' && item.body.trim() === comment.body)) {
    result.skipped.push(`${label}: duplicate agent reply skipped`);
    return false;
  }

  const now = new Date().toISOString();
  thread.comments.push({
    id: crypto.randomUUID(),
    body: comment.body,
    author: 'agent',
    createdAt: now,
    updatedAt: now
  });
  if (thread.status !== 'resolved') {
    thread.status = 'replied';
  }
  thread.updatedAt = now;
  return true;
}

function buildAgentThread(comment: ImportThreadComment, diffFiles: DiffFile[], result: ImportCommentsResult, label: string): ReviewThread | undefined {
  const file = diffFiles.find((item) => item.path === comment.filePath || item.oldPath === comment.filePath || item.newPath === comment.filePath);
  if (!file) {
    result.skipped.push(`${label}: ${comment.filePath} is not present in the current diff`);
    return undefined;
  }

  const anchor = buildAnchor(file, comment, result, label);
  if (!anchor) return undefined;

  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    filePath: anchor.filePath,
    anchor,
    status: 'replied',
    comments: [
      {
        id: crypto.randomUUID(),
        body: comment.body,
        author: 'agent',
        createdAt: now,
        updatedAt: now
      }
    ],
    createdAt: now,
    updatedAt: now
  };
}

function buildAnchor(file: DiffFile, comment: ImportThreadComment, result: ImportCommentsResult, label: string): CommentAnchor | undefined {
  if (!comment.position) {
    return { type: 'file', filePath: file.path };
  }

  const position = comment.position;
  if (isMarkdownPosition(position)) {
    const line = getStartLine(position.line);
    if (!Number.isInteger(line) || line < 1) {
      result.skipped.push(`${label}: markdown position requires a positive line number`);
      return undefined;
    }
    if (!file.isMarkdown) {
      result.skipped.push(`${label}: markdown position can only be used for Markdown files`);
      return undefined;
    }
    return { type: 'markdown-line', filePath: file.path, lineNumber: line, blockId: `line-${line}` };
  }

  const side = position.side ?? 'new';
  const line = getStartLine(position.line);
  if (!Number.isInteger(line) || line < 1) {
    result.skipped.push(`${label}: diff position requires a positive line number`);
    return undefined;
  }
  if (!diffLineExists(file, side, line)) {
    result.skipped.push(`${label}: ${file.path}:${line} (${side}) is not present in the current diff`);
    return undefined;
  }
  return { type: 'diff-line', filePath: file.path, side, lineNumber: line };
}

function hasDuplicateAgentComment(threads: ReviewThread[], nextThread: ReviewThread): boolean {
  const nextComment = nextThread.comments[0]?.body.trim();
  return threads.some((thread) => {
    return (
      thread.comments.some((comment) => comment.author === 'agent' && comment.body.trim() === nextComment) &&
      thread.filePath === nextThread.filePath &&
      sameAnchor(thread.anchor, nextThread.anchor)
    );
  });
}

function diffLineExists(file: DiffFile, side: 'old' | 'new', lineNumber: number): boolean {
  return file.hunks.some((hunk) =>
    hunk.lines.some((line) => (side === 'old' ? line.oldLineNumber === lineNumber : line.newLineNumber === lineNumber))
  );
}

function isMarkdownPosition(position: ImportPosition): position is { type: 'markdown'; line: number | { start: number; end?: number } } {
  return 'type' in position && position.type === 'markdown';
}

function parsePosition(value: unknown): ImportPosition | undefined {
  if (!isRecord(value)) return undefined;

  if (value.type === 'markdown') {
    return { type: 'markdown', line: parseLine(value.line) };
  }

  const side = value.side === 'old' || value.side === 'new' ? value.side : undefined;
  return { side, line: parseLine(value.line) };
}

function parseLine(value: unknown): number | { start: number; end?: number } {
  if (typeof value === 'number') return value;
  if (isRecord(value) && typeof value.start === 'number') {
    return typeof value.end === 'number' ? { start: value.start, end: value.end } : { start: value.start };
  }
  return Number.NaN;
}

function getStartLine(line: number | { start: number; end?: number } | undefined): number {
  if (typeof line === 'number') return line;
  return line?.start ?? Number.NaN;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
