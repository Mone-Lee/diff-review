/**
 * 评论附件 API：上传图片原始字节、生成预览地址，以及清理未提交的草稿图片。
 */
import type { ReviewAttachment } from '../../shared/attachments';

export function attachmentUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}`;
}

export async function uploadAttachment(file: File): Promise<ReviewAttachment> {
  const response = await fetch(`/api/attachments?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'Content-Type': file.type }, body: file
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '图片上传失败');
  return data as ReviewAttachment;
}

export async function discardAttachment(id: string): Promise<void> {
  const response = await fetch(attachmentUrl(id), { method: 'DELETE', keepalive: true });
  if (!response.ok) throw new Error('清理草稿图片失败');
}
