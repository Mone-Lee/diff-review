/**
 * 内容读取 API 封装：负责请求 markdown 预览、diff 文件内容与 markdown 资源地址转换，屏蔽前端调用细节。
 */
import type { MarkdownPreview } from '../../shared/types';
import type { FileContents } from '../components/CodeDiffViewer/types';

/**
 * 拉取 markdown 文件的结构化预览内容。
 */
export async function fetchMarkdownPreview(filePath: string) {
  const res = await fetch(`/api/markdown-preview?path=${encodeURIComponent(filePath)}`);
  return (await res.json()) as MarkdownPreview;
}

/**
 * 拉取 diff 对应的原始文件内容，支持中断信号。
 */
export async function fetchDiffFileContents(filePath: string, signal?: AbortSignal) {
  const res = await fetch(`/api/diff-file-contents?path=${encodeURIComponent(filePath)}`, { signal });
  if (!res.ok) return null;
  return (await res.json()) as FileContents;
}

function normalizePathSegments(path: string) {
  const segments = path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized;
}

/**
 * 将 markdown 内的相对资源路径转换成后端可访问的资源 URL。
 */
export function buildMarkdownAssetUrl(markdownPath: string, rawUrl: string) {
  if (!rawUrl || /^https?:|^mailto:|^#/i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith('/')) return rawUrl;

  const cleanUrl = rawUrl.split('#')[0]?.split('?')[0] ?? rawUrl;
  const fileSegments = normalizePathSegments(markdownPath);
  fileSegments.pop();
  const targetSegments = normalizePathSegments(cleanUrl);
  const resolvedPath = [...fileSegments, ...targetSegments].join('/');
  if (!resolvedPath) return rawUrl;
  return `/api/markdown-asset?path=${encodeURIComponent(resolvedPath)}`;
}
