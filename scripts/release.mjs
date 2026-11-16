/** 从当前提交创建隔离的发布工作树，避免发布过程触碰用户的工作区和暂存区。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const registry = 'https://registry.npmjs.org/';
const releaseType = process.argv[2] ?? 'patch';
if (!['patch', 'minor', 'major'].includes(releaseType)) {
  throw new Error('Usage: npm run release [patch|minor|major]');
}

function run(command, args, cwd, capture = false) {
  if (!capture) console.log(`\n$ ${[command, ...args].join(' ')}`);
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  })?.trim();
}

const root = run('git', ['rev-parse', '--show-toplevel'], undefined, true);
const branch = run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], root, true);
const head = run('git', ['rev-parse', 'HEAD'], root, true);
const upstream = run('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], root, true);
const remote = run('git', ['config', '--get', `branch.${branch}.remote`], root, true);
const remoteBranch = run('git', ['config', '--get', `branch.${branch}.merge`], root, true);
if (remote === '.' || !remoteBranch.startsWith('refs/heads/')) throw new Error('Release requires a remote branch upstream.');
try {
  run('git', ['merge-base', '--is-ancestor', upstream, head], root);
} catch {
  throw new Error('The upstream branch must be an ancestor of the current commit before releasing.');
}

try {
  run('npm', ['whoami', `--registry=${registry}`], root);
} catch {
  run('npm', ['login', `--registry=${registry}`], root);
  run('npm', ['whoami', `--registry=${registry}`], root);
}
run('npm', ['ping', `--registry=${registry}`], root);

const directory = mkdtempSync(join(tmpdir(), 'diff-review-release-'));
let worktreeCreated = false;
try {
  run('git', ['worktree', 'add', '--detach', directory, head], root);
  worktreeCreated = true;
  run('npm', ['ci'], directory);
  run('npm', ['run', 'release:check'], directory);
  run('npm', ['version', releaseType, '--no-git-tag-version'], directory);
  const version = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).version;
  run('git', ['add', '--', 'package.json', 'package-lock.json'], directory);
  run('git', ['commit', '-m', `release: v${version}`], directory);
  run('git', ['tag', `v${version}`], directory);
  run('npm', ['publish', `--registry=${registry}`], directory);
  run('git', ['push', remote, `HEAD:${remoteBranch}`, `refs/tags/v${version}`], directory);
  console.log(`\nRelease v${version} published. Your local branch remains at ${head}; update it after preserving your changes.`);
} finally {
  if (worktreeCreated) run('git', ['worktree', 'remove', '--force', directory], root);
  rmSync(directory, { recursive: true, force: true });
}
