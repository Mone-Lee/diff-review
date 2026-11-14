/**
 * 评论图片协议：集中定义本地附件元数据和前后端共用的容量、格式约束。
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_COMMENT_ATTACHMENTS = 8;
export const ATTACHMENT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** 本地评论的图片引用；path 由服务端生成，供同机 agent 读取，不可移植到分享页。 */
export type ReviewAttachment = {
  id: string;
  name: string;
  mimeType: typeof ATTACHMENT_MIME_TYPES[number];
  size: number;
  path: string;
};
