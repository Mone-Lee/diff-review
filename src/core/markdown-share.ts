/**
 * 独立 Markdown 分享会话：校验仓库内文件并构造可复用现有预览器的虚拟审查快照。
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';
import type { ReviewSession } from '../shared/types';
import { DEFAULT_SHARE_BASE_URL } from '../shared/share';
import { createVirtualMarkdownDiffFile, markdownContentHash } from './virtual-markdown';

export type MarkdownShareSnapshot = {
  session: ReviewSession;
  diffFiles: ReturnType<typeof createVirtualMarkdownDiffFile>[];
  virtualFiles: Record<string, string>;
};

export async function buildMarkdownShareSnapshot(
  repoRoot: string,
  fileInput: string
): Promise<MarkdownShareSnapshot> {
  const realRepoRoot = await realpath(repoRoot);
  const requestedPath = resolve(isAbsolute(fileInput) ? fileInput : resolve(repoRoot, fileInput));
  const realFilePath = await realpath(requestedPath).catch(() => {
    throw new Error(`Markdown file not found: ${fileInput}`);
  });
  const relativePath = relative(realRepoRoot, realFilePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Markdown share file must be inside the repository');
  }
  const extension = extname(realFilePath).toLowerCase();
  if (extension !== '.md' && extension !== '.markdown') {
    throw new Error('Markdown share only supports .md and .markdown files');
  }
  const fileStat = await stat(realFilePath);
  if (!fileStat.isFile()) throw new Error('Markdown share target must be a regular file');
  const content = await readFile(realFilePath, 'utf8');
  const diffFile = createVirtualMarkdownDiffFile(relativePath, content);
  const contentHash = markdownContentHash(content);
  const now = new Date().toISOString();
  const session: ReviewSession = {
    id: crypto.randomUUID(),
    repoName: basename(realRepoRoot) || 'workspace',
    repoRoot: realRepoRoot,
    mode: { kind: 'revision', base: 'file', target: contentHash, targetLabel: 'Markdown Share' },
    diffHash: contentHash,
    createdAt: now,
    reviewKind: 'markdown-share',
    shareBaseUrl: DEFAULT_SHARE_BASE_URL,
    shareId: crypto.randomUUID()
  };
  return {
    session,
    diffFiles: [diffFile],
    virtualFiles: { [relativePath]: content }
  };
}
