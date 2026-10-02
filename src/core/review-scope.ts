/**
 * Skill 文件范围：解析 agent 传入的上下文文件路径，并按完整 Git diff 的新旧路径筛选，保留重命名信息。
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseUnifiedDiff } from './diff-parser';

// 环境变量仅供 Skill 在单次启动时传递上下文文件；不设置时保持全仓库审查。
export function readSkillSelectedFiles(value: string | undefined, repoRoot: string, cwd: string): string[] | undefined {
  if (value === undefined) return undefined;
  const paths: unknown = JSON.parse(value);
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || !path.trim())) {
    throw new Error('DIFF_REVIEW_SKILL_FILES must be a JSON array of non-empty file paths');
  }
  return [...new Set((paths as string[]).map((path) => {
    const repoPath = relative(repoRoot, resolve(cwd, path));
    if (!repoPath || repoPath === '..' || repoPath.startsWith(`..${sep}`) || isAbsolute(repoPath)) {
      throw new Error(`Selected file must be inside the review repository: ${path}`);
    }
    return repoPath.split(sep).join('/');
  }))];
}

// 先生成完整 diff 再筛选，避免 Git pathspec 将跨路径重命名降为单侧新增或删除。
export function filterDiffBySelectedFiles(diff: string, selectedFiles?: string[]): string {
  if (selectedFiles === undefined) return diff;
  const selected = new Set(selectedFiles);
  return diff.split(/(?=^diff --git )/m).filter((block) => {
    const file = parseUnifiedDiff(block)[0];
    return file && (selected.has(file.path) || selected.has(file.oldPath));
  }).join('');
}
