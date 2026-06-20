/**
 * App 页面状态辅助工具：承载文件顺序预处理、会话展示补充信息、集合/数据比较，
 * 以及 `viewed` 审查状态的本地持久化读写，避免这些页面级杂项逻辑混入主组件。
 */
import type { DiffFile, ReviewSession, ReviewThread } from '../../shared/types';
import { buildFileTree, flattenFileTree } from '../components/FileList/utils';

export function isImageFilePath(path: string) {
  return /\.(avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(path);
}

export function sessionRepoName(session: ReviewSession | null) {
  if (!session) return '正在加载仓库';
  return session.repoName || session.repoRoot.split(/[\\/]/).filter(Boolean).at(-1) || session.repoRoot;
}

export function areThreadsEqual(left: ReviewThread[], right: ReviewThread[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function areFilesEqual(left: DiffFile[], right: DiffFile[]) {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((file, index) => {
    const candidate = right[index];
    return (
      candidate &&
      file.path === candidate.path &&
      file.snapshotHash === candidate.snapshotHash &&
      file.status === candidate.status &&
      file.additions === candidate.additions &&
      file.deletions === candidate.deletions
    );
  });
}

export function areStringSetsEqual(left: Set<string>, right: Set<string>) {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  return [...left].every((value) => right.has(value));
}

/**
 * `viewed` 只服务于当前审查界面，不需要进入服务端协议；按仓库和 diff 快照做本地持久化即可。
 */
export function viewedStorageKey(session: ReviewSession) {
  return `diff-review:viewed:${session.repoRoot}:${session.diffHash}`;
}

/**
 * 从本地恢复当前审查快照的 viewed 集合；存储异常时静默兜底为空集合，避免影响主流程。
 */
export function readViewedFilePaths(storageKey: string) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

/**
 * 把 viewed 文件集合写回浏览器存储，让页面刷新后仍能保留当前审查进度。
 */
export function writeViewedFilePaths(storageKey: string, filePaths: Set<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...filePaths]));
  } catch {
    // 忽略浏览器存储失败，保持 UI 交互可用。
  }
}

/**
 * 文件默认选中顺序也复用树视图的遍历结果，确保列表模式、树模式和初始选中保持同一套顺序来源。
 */
export function sortFilesByPath(files: DiffFile[]) {
  return flattenFileTree(buildFileTree(files));
}
