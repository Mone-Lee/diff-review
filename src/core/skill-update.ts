/**
 * Skill 更新工具：把当前 npm 包携带的 SKILL.md 同步到本机 Agent Skill 目录，并清理旧版嵌套副本。
 */
import { copyFile, mkdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export type SkillUpdateResult = {
  changed: boolean;
  targetPath: string;
};

export async function updateInstalledSkill(sourcePath: string, configuredTargetDir?: string): Promise<SkillUpdateResult> {
  const targetDir = resolve(configuredTargetDir || join(homedir(), '.agents/skills/diff-review'));
  if (basename(targetDir) !== 'diff-review') {
    throw new Error(`Skill target directory must end with "diff-review": ${targetDir}`);
  }

  const targetPath = join(targetDir, 'SKILL.md');
  const legacySkillRoot = join(targetDir, 'skill');
  const legacySkillDir = join(legacySkillRoot, 'diff-review');
  const [source, installed, hasLegacySkill] = await Promise.all([
    readFile(sourcePath),
    readOptionalFile(targetPath),
    pathExists(legacySkillDir)
  ]);
  const contentChanged = !installed?.equals(source);

  await mkdir(targetDir, { recursive: true });
  if (contentChanged) await copyFile(sourcePath, targetPath);
  await rm(legacySkillDir, { recursive: true, force: true });
  try {
    await rmdir(legacySkillRoot);
  } catch (error) {
    if (!isExpectedDirectoryError(error)) throw error;
  }

  return { changed: contentChanged || hasLegacySkill, targetPath };
}

async function readOptionalFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// 非空目录可能包含用户文件，此时只移除旧版 diff-review 副本并保留其父目录。
function isExpectedDirectoryError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY');
}
