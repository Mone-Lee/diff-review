import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join, normalize, relative } from 'node:path';
import type { DiffFile, ReviewMode } from '../shared/types';

const execFileAsync = promisify(execFile);

export async function getRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await execGit(['rev-parse', '--show-toplevel'], cwd);
  return stdout.trim();
}

export async function getDiff(mode: ReviewMode, repoRoot: string): Promise<string> {
  if (mode.kind === 'staged') {
    return execGitStdout(['diff', '--cached', '--no-ext-diff', '--no-color'], repoRoot);
  }

  if (mode.kind === 'revision') {
    return execGitStdout(['diff', '--no-ext-diff', '--no-color', mode.base, mode.target], repoRoot);
  }

  const trackedDiff = await execGitStdout(['diff', '--no-ext-diff', '--no-color'], repoRoot);
  const untrackedDiff = await getUntrackedDiff(repoRoot);
  return [trackedDiff, untrackedDiff].filter(Boolean).join('\n');
}

export async function readFileForPreview(file: DiffFile, mode: ReviewMode, repoRoot: string): Promise<{ content: string; deleted: boolean }> {
  const targetPath = file.status === 'deleted' ? file.oldPath : file.path;

  if (!isSafeRepoPath(repoRoot, targetPath)) {
    throw new Error(`Unsafe file path: ${targetPath}`);
  }

  if (mode.kind === 'staged') {
    if (file.status === 'deleted') {
      return { content: await gitShow(`HEAD:${targetPath}`, repoRoot), deleted: true };
    }
    return { content: await gitShow(`:${targetPath}`, repoRoot), deleted: false };
  }

  if (mode.kind === 'revision') {
    const ref = file.status === 'deleted' ? mode.base : mode.target;
    return { content: await gitShow(`${ref}:${targetPath}`, repoRoot), deleted: file.status === 'deleted' };
  }

  if (file.status === 'deleted') {
    return { content: await gitShow(`HEAD:${targetPath}`, repoRoot), deleted: true };
  }

  return { content: await readFile(join(repoRoot, targetPath), 'utf8'), deleted: false };
}

export function parseReviewMode(args: string[]): ReviewMode {
  const filtered = args.filter(Boolean);
  if (filtered.length === 0 || filtered[0] === 'working') return { kind: 'working' };
  if (filtered[0] === 'staged') return { kind: 'staged' };
  if (filtered.length === 2) return { kind: 'revision', base: filtered[0], target: filtered[1] };
  throw new Error('Usage: /diff-review [working|staged|<base> <target>]');
}

export function diffHash(diff: string): string {
  return createHash('sha256').update(diff).digest('hex').slice(0, 16);
}

function isSafeRepoPath(repoRoot: string, path: string): boolean {
  const normalized = normalize(join(repoRoot, path));
  const rel = relative(repoRoot, normalized);
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/');
}

async function gitShow(revPath: string, repoRoot: string): Promise<string> {
  return execGitStdout(['show', revPath], repoRoot);
}

async function execGitStdout(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execGit(args, cwd);
  return stdout;
}

async function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024 * 80
  });
  return { stdout, stderr };
}

async function getUntrackedDiff(repoRoot: string): Promise<string> {
  const stdout = await execGitStdout(['ls-files', '--others', '--exclude-standard'], repoRoot);
  const paths = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const diffs = await Promise.all(
    paths.map(async (path) => {
      if (!isSafeRepoPath(repoRoot, path)) return '';
      const content = await readFile(join(repoRoot, path));
      if (content.includes(0)) return binaryAddedDiff(path);
      return textAddedDiff(path, content.toString('utf8'));
    })
  );

  return diffs.filter(Boolean).join('\n');
}

function textAddedDiff(path: string, content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const hasTrailingNewline = lines.at(-1) === '';
  const bodyLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const additions = bodyLines.map((line) => `+${line}`).join('\n');
  const noNewline = hasTrailingNewline ? '' : '\n\\ No newline at end of file';
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..0000000',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${bodyLines.length} @@`,
    additions + noNewline
  ].join('\n');
}

function binaryAddedDiff(path: string): string {
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644', 'index 0000000..0000000', `Binary files /dev/null and b/${path} differ`].join('\n');
}
