/**
 * Skill 更新工具：把当前 npm 包携带的 SKILL.md 同步到本机 Agent Skill 目录，并清理旧版嵌套副本。
 */
import { mkdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export type SkillUpdateResult = {
  changed: boolean;
  targetPath: string;
};

const npmCommandPrefix = 'npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest';

export async function updateInstalledSkill(
  sourcePath: string,
  configuredTargetDir?: string,
  commandPrefix = npmCommandPrefix
): Promise<SkillUpdateResult> {
  const targetDir = resolve(configuredTargetDir || join(homedir(), '.agents/skills/diff-review'));
  if (basename(targetDir) !== 'diff-review') {
    throw new Error(`Skill target directory must end with "diff-review": ${targetDir}`);
  }

  const targetPath = join(targetDir, 'SKILL.md');
  const legacySkillRoot = join(targetDir, 'skill');
  const legacySkillDir = join(legacySkillRoot, 'diff-review');
  const [sourceTemplate, installed, hasLegacySkill] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readOptionalFile(targetPath),
    pathExists(legacySkillDir)
  ]);
  const source = renderSkillSource(sourceTemplate, commandPrefix);
  const contentChanged = installed?.toString('utf8') !== source;

  await mkdir(targetDir, { recursive: true });
  if (contentChanged) await writeFile(targetPath, source, 'utf8');
  await rm(legacySkillDir, { recursive: true, force: true });
  try {
    await rmdir(legacySkillRoot);
  } catch (error) {
    if (!isExpectedDirectoryError(error)) throw error;
  }

  return { changed: contentChanged || hasLegacySkill, targetPath };
}

// 本地调试版 Skill 跳过 npm 自更新，并把所有调用固定到 npm link 提供的全局命令。
export function renderSkillSource(source: string, commandPrefix = npmCommandPrefix): string {
  if (commandPrefix === npmCommandPrefix) return source;
  const updateStart = 'Before any other action for each Diff Review task, run this update once from the target workspace:';
  const commandStart = 'Do not ask the user to run a shell CLI manually.';
  const startIndex = source.indexOf(updateStart);
  const endIndex = source.indexOf(commandStart);
  const withoutUpdateCheck = startIndex >= 0 && endIndex > startIndex
    ? `${source.slice(0, startIndex)}${source.slice(endIndex)}`
    : source;
  return withoutUpdateCheck.replaceAll(npmCommandPrefix, commandPrefix);
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
