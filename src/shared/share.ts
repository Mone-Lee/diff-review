/**
 * Markdown 分享协议：定义可移植载荷、URL Fragment 编解码与跨运行时输入校验。
 */
import type { CommentAnchor, DiffFile, ReviewSession, ReviewThread } from './types';

export const DEFAULT_SHARE_BASE_URL = 'https://mone-lee.github.io/diff-review/share.html';
export const SHARE_PAYLOAD_VERSION = 1;
export const MAX_SHARE_URL_BYTES = 32 * 1024;
const MAX_MARKDOWN_LENGTH = 500_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_THREADS = 2_000;
const MAX_COMMENTS = 5_000;
const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;

export type ShareAnchor =
  | { type: 'file'; filePath: string }
  | { type: 'markdown-line'; filePath: string; lineNumber: number; blockId?: string };

export type ShareComment = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  source: 'local' | 'reviewer';
  reviewerId?: string;
  originShareId?: string;
};

export type ShareThread = {
  id: string;
  anchor: ShareAnchor;
  comments: ShareComment[];
};

export type MarkdownSharePayload = {
  version: 1;
  shareId: string;
  title: string;
  filePath: string;
  markdown: string;
  contentHash: string;
  threads: ShareThread[];
};

/**
 * 分享入口只面向单一 Markdown 快照；这同时覆盖 plan、Skill 自选单文件和本身只有一个文件的 diff。
 */
export function getShareableMarkdownFile(session: ReviewSession | null, files: DiffFile[]): DiffFile | null {
  if (!session || files.length !== 1 || !files[0].isMarkdown) return null;
  return files[0];
}

export function isShareableAnchor(anchor: CommentAnchor): anchor is ShareAnchor {
  return anchor.type === 'file' || anchor.type === 'markdown-line';
}

export function reviewThreadsToShareThreads(threads: ReviewThread[]): ShareThread[] {
  return threads
    .filter((thread) => isShareableAnchor(thread.anchor))
    .map((thread) => ({
      id: thread.id,
      anchor: thread.anchor as ShareAnchor,
      comments: thread.comments.map((comment) => ({
        id: comment.shareOrigin?.commentId ?? comment.id,
        body: comment.body,
        authorName: comment.authorName ?? (comment.author === 'agent' ? 'Agent' : '发起者'),
        createdAt: comment.createdAt,
        source: comment.author === 'reviewer' ? 'reviewer' : 'local',
        reviewerId: comment.shareOrigin?.reviewerId,
        originShareId: comment.shareOrigin?.shareId
      }))
    }));
}

export async function encodeSharePayload(payload: MarkdownSharePayload): Promise<string> {
  const validated = validateSharePayload(payload);
  const input = new TextEncoder().encode(JSON.stringify(validated));
  const compressed = await transformBytes(input, new CompressionStream('deflate-raw'));
  return toBase64Url(compressed);
}

export async function decodeSharePayload(encoded: string): Promise<MarkdownSharePayload> {
  if (!encoded || encoded.length > MAX_SHARE_URL_BYTES) throw new Error('分享链接为空或超过大小限制');
  try {
    const compressed = fromBase64Url(encoded);
    const output = await transformBytes(compressed, new DecompressionStream('deflate-raw'), MAX_DECOMPRESSED_BYTES);
    return validateSharePayload(JSON.parse(new TextDecoder().decode(output)));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('分享')) throw error;
    throw new Error('分享链接内容无效或已损坏');
  }
}

export async function buildShareUrl(baseUrl: string, payload: MarkdownSharePayload): Promise<string> {
  const normalizedBase = normalizeShareBaseUrl(baseUrl);
  const url = `${normalizedBase}#share=${await encodeSharePayload(payload)}`;
  if (new TextEncoder().encode(url).byteLength > MAX_SHARE_URL_BYTES) {
    throw new Error('分享链接超过 32 KiB 限制，请缩短文档或评论');
  }
  return url;
}

export async function parseShareUrl(value: string): Promise<MarkdownSharePayload> {
  if (new TextEncoder().encode(value).byteLength > MAX_SHARE_URL_BYTES) throw new Error('分享链接超过 32 KiB 限制');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入完整的分享链接');
  }
  const encoded = new URLSearchParams(url.hash.slice(1)).get('share');
  if (!encoded) throw new Error('链接中缺少分享内容');
  return decodeSharePayload(encoded);
}

export function normalizeShareBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('分享门户地址必须是有效的 http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('分享门户地址仅支持 http(s)');
  }
  url.hash = '';
  url.search = '';
  return url.toString();
}

export function validateSharePayload(value: unknown): MarkdownSharePayload {
  if (!isRecord(value) || value.version !== SHARE_PAYLOAD_VERSION) throw new Error('分享协议版本不受支持');
  const shareId = requiredString(value.shareId, '分享 ID', 200);
  const title = requiredString(value.title, '标题', 500);
  const filePath = requiredString(value.filePath, '文件路径', 2_000);
  const markdown = stringValue(value.markdown, 'Markdown', MAX_MARKDOWN_LENGTH);
  const contentHash = requiredString(value.contentHash, '内容摘要', 200);
  if (!Array.isArray(value.threads) || value.threads.length > MAX_THREADS) throw new Error('分享线程数量无效');
  const lineCount = markdown.replace(/\r\n/g, '\n').split('\n').length;
  const threads = value.threads.map((thread) => validateThread(thread, filePath, lineCount));
  if (threads.reduce((total, thread) => total + thread.comments.length, 0) > MAX_COMMENTS) {
    throw new Error('分享评论数量无效');
  }
  return { version: SHARE_PAYLOAD_VERSION, shareId, title, filePath, markdown, contentHash, threads };
}

function validateThread(value: unknown, filePath: string, lineCount: number): ShareThread {
  if (!isRecord(value)) throw new Error('分享线程格式无效');
  const id = requiredString(value.id, '线程 ID', 200);
  const anchor = validateAnchor(value.anchor, filePath, lineCount);
  if (!Array.isArray(value.comments) || value.comments.length > MAX_THREADS) throw new Error('分享评论数量无效');
  const comments = value.comments.map(validateComment);
  return { id, anchor, comments };
}

function validateAnchor(value: unknown, filePath: string, lineCount: number): ShareAnchor {
  if (!isRecord(value) || value.filePath !== filePath) throw new Error('分享锚点文件不匹配');
  if (value.type === 'file') return { type: 'file', filePath };
  if (value.type !== 'markdown-line' || !Number.isInteger(value.lineNumber)) throw new Error('分享锚点格式无效');
  const lineNumber = value.lineNumber as number;
  if (lineNumber < 1 || lineNumber > lineCount) throw new Error('分享锚点超出文档范围');
  const blockId = typeof value.blockId === 'string' && value.blockId.length <= 500 ? value.blockId : undefined;
  return { type: 'markdown-line', filePath, lineNumber, blockId };
}

function validateComment(value: unknown): ShareComment {
  if (!isRecord(value)) throw new Error('分享评论格式无效');
  const source = value.source === 'local' || value.source === 'reviewer' ? value.source : null;
  if (!source) throw new Error('分享评论来源无效');
  const reviewerId = typeof value.reviewerId === 'string' && value.reviewerId.length <= 200 ? value.reviewerId : undefined;
  const originShareId = typeof value.originShareId === 'string' && value.originShareId.length <= 200 ? value.originShareId : undefined;
  if (source === 'reviewer' && !reviewerId) throw new Error('审阅者评论缺少身份标识');
  const createdAt = requiredString(value.createdAt, '评论时间', 100);
  if (Number.isNaN(Date.parse(createdAt))) throw new Error('评论时间格式无效');
  return {
    id: requiredString(value.id, '评论 ID', 200),
    body: requiredString(value.body, '评论内容', MAX_TEXT_LENGTH),
    authorName: requiredString(value.authorName, '审阅者昵称', 100),
    createdAt,
    source,
    ...(reviewerId ? { reviewerId } : {}),
    ...(originShareId ? { originShareId } : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  const result = stringValue(value, label, maxLength).trim();
  if (!result) throw new Error(`${label}不能为空`);
  return result;
}

function stringValue(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label}格式无效`);
  return value;
}

async function transformBytes(
  input: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  maxOutputBytes = Number.POSITIVE_INFINITY
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const safeInput = new Uint8Array(input.byteLength);
  safeInput.set(input);
  const writing = writer.write(safeInput).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxOutputBytes) {
      await reader.cancel();
      await writer.abort().catch(() => undefined);
      await writing.catch(() => undefined);
      throw new Error('分享链接解压后的内容超过安全限制');
    }
    chunks.push(value);
  }
  await writing;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('分享链接编码无效');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
