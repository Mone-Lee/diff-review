/**
 * 用户数据路径：为评论日志和图片附件提供一致的跨平台目录与仓库隔离标识。
 */
import { createHash } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';

export function reviewDataDir(): string {
  return platform() === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'diff-review')
    : join(homedir(), '.local', 'diff-review');
}

export function repositoryStorageKey(repoRoot: string): string {
  const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
  return `${basename(repoRoot) || 'repo'}-${hash}`;
}
