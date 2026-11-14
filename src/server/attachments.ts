/**
 * 本地图片附件存储：校验上传内容、生成可信文件引用，并在评论解除引用后回收图片。
 * 调用方在评论存储队列内执行写入与清理，避免附件保存和删除之间的竞态。
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, MAX_COMMENT_ATTACHMENTS, type ReviewAttachment } from '../shared/attachments';
import type { ReviewThread } from '../shared/types';
import { repositoryStorageKey, reviewDataDir } from './data-paths';

const ATTACHMENT_ID = /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
const ORPHAN_RETENTION_MS = 24 * 60 * 60 * 1000;

/** 可直接返回给界面的附件输入错误，区别于磁盘等内部故障。 */
export class AttachmentInputError extends Error {}

export function attachmentsDir(repoRoot: string): string {
  return join(reviewDataDir(), 'attachments', repositoryStorageKey(repoRoot));
}

export async function saveAttachment(repoRoot: string, bytes: Buffer, mimeType: string, name: string): Promise<ReviewAttachment> {
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachmentInputError('图片大小须在 1 字节至 10 MiB 之间');
  const extension = detectImageExtension(bytes);
  const expectedType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
  if (!extension || !ATTACHMENT_MIME_TYPES.includes(mimeType as ReviewAttachment['mimeType']) || mimeType !== expectedType) {
    throw new AttachmentInputError('仅支持内容与格式一致的 PNG、JPEG、WebP、GIF 图片');
  }
  const id = `${crypto.randomUUID()}.${extension}`;
  const path = join(attachmentsDir(repoRoot), id);
  const attachment: ReviewAttachment = {
    id, name: name.replace(/[\r\n\x00-\x1f]/g, '').slice(0, 255) || `image.${extension}`,
    mimeType: mimeType as ReviewAttachment['mimeType'], size: bytes.length, path
  };
  await mkdir(attachmentsDir(repoRoot), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx' });
    await writeFile(`${path}.json`, JSON.stringify(attachment), { flag: 'wx' });
  } catch (error) {
    await removeAttachment(repoRoot, id);
    throw error;
  }
  return attachment;
}

// 只接受仓库附件 ID；文件路径、格式和大小均从服务端文件重新获取，不信任请求携带的元数据。
export async function readAttachment(repoRoot: string, id: string): Promise<ReviewAttachment> {
  if (!ATTACHMENT_ID.test(id)) throw new AttachmentInputError('图片附件 ID 无效');
  const path = join(attachmentsDir(repoRoot), id);
  try {
    const metadata = JSON.parse(await readFile(`${path}.json`, 'utf8')) as ReviewAttachment;
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
    return { ...metadata, id, path, size: info.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AttachmentInputError('图片附件不存在，请重新上传');
    throw error;
  }
}

export async function resolveCommentAttachments(repoRoot: string, value: unknown): Promise<ReviewAttachment[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_COMMENT_ATTACHMENTS) throw new AttachmentInputError('每条评论最多添加 8 张图片');
  const ids = value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('id' in item) || typeof item.id !== 'string') throw new AttachmentInputError('图片附件格式无效');
    return item.id;
  });
  if (new Set(ids).size !== ids.length) throw new AttachmentInputError('图片附件重复');
  return Promise.all(ids.map((id) => readAttachment(repoRoot, id)));
}

export function referencedAttachmentIds(threads: ReviewThread[]): Set<string> {
  return new Set(threads.flatMap((thread) => thread.comments.flatMap((comment) => (comment.attachments ?? []).map((attachment) => attachment.id))));
}

// 显式移除的附件立即回收；其余未引用文件在一天后回收，覆盖关闭页面、崩溃和清理失败的遗留上传。
export async function cleanupAttachments(repoRoot: string, threads: ReviewThread[], removedIds: Iterable<string> = []): Promise<void> {
  const referenced = referencedAttachmentIds(threads);
  const removed = new Set(removedIds);
  const directory = attachmentsDir(repoRoot);
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const ids = new Set(names.map((name) => name.replace(/\.json$/, '')).filter((id) => ATTACHMENT_ID.test(id)));
  for (const id of ids) {
    if (referenced.has(id)) continue;
    try {
      const info = await stat(join(directory, id)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return stat(join(directory, `${id}.json`));
        throw error;
      });
      if (removed.has(id) || Date.now() - info.mtimeMs > ORPHAN_RETENTION_MS) await removeAttachment(repoRoot, id);
    } catch (error) {
      console.warn(`Failed to clean up attachment ${id}: ${String(error)}`);
    }
  }
}

async function removeAttachment(repoRoot: string, id: string): Promise<void> {
  if (!ATTACHMENT_ID.test(id)) return;
  const path = join(attachmentsDir(repoRoot), id);
  await rm(path, { force: true });
  await rm(`${path}.json`, { force: true });
}

function detectImageExtension(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return undefined;
}
