/**
 * 本机 Skill 同步脚本：以仓库根目录 SKILL.md 为唯一来源，并清理旧版嵌套副本。
 */
import { copyFile, mkdir, readFile, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('../SKILL.md', import.meta.url));
const targetDir = resolve(process.env.DIFF_REVIEW_SKILL_DIR || join(homedir(), '.agents/skills/diff-review'));

if (basename(targetDir) !== 'diff-review') {
  throw new Error(`Skill target directory must end with "diff-review": ${targetDir}`);
}

const targetPath = join(targetDir, 'SKILL.md');
await mkdir(targetDir, { recursive: true });
await copyFile(sourcePath, targetPath);

const legacySkillRoot = join(targetDir, 'skill');
await rm(join(legacySkillRoot, 'diff-review'), { recursive: true, force: true });
try {
  await rmdir(legacySkillRoot);
} catch (error) {
  if (!isExpectedDirectoryError(error)) throw error;
}

const [source, installed] = await Promise.all([readFile(sourcePath), readFile(targetPath)]);
if (!source.equals(installed)) {
  throw new Error(`Installed Skill does not match ${sourcePath}`);
}

console.log(`Diff Review Skill updated: ${targetPath}`);

// 非空目录可能包含用户文件，此时只移除旧版 diff-review 副本并保留其父目录。
function isExpectedDirectoryError(error) {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY');
}
