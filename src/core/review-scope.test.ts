/**
 * Skill 文件范围回归测试：覆盖上下文路径解析，以及实际 Git 仓库中各模式、空范围和重命名的筛选行为。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseUnifiedDiff } from './diff-parser';
import { getDiff } from './git';
import { readSkillSelectedFiles } from './review-scope';

test('context paths normalize relative to the invocation directory and reject invalid scope', () => {
  assert.equal(readSkillSelectedFiles(undefined, '/repo', '/repo/src'), undefined);
  assert.deepEqual(readSkillSelectedFiles('["foo.ts","/repo/src/foo.ts","../bar.ts"]', '/repo', '/repo/src'), ['src/foo.ts', 'bar.ts']);
  assert.deepEqual(readSkillSelectedFiles('[]', '/repo', '/repo'), []);
  for (const input of ['{}', '[1]', '[""]', '["../outside.ts"]', '["/repo"]']) {
    assert.throws(() => readSkillSelectedFiles(input, '/repo', '/repo'));
  }
});

test('selected files filter working, staged and revision diffs without widening an empty result', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'diff-review-scope-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    git('init', '--quiet', '--initial-branch=main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    for (const path of ['selected file.ts', 'other.ts', 'unchanged.ts', '中文.ts', 'old.ts']) {
      await writeFile(join(repo, path), 'original\n');
    }
    git('add', '.');
    git('commit', '-m', 'initial');
    await writeFile(join(repo, 'selected file.ts'), 'selected change\n');
    await writeFile(join(repo, 'other.ts'), 'other change\n');
    await writeFile(join(repo, '中文.ts'), 'unicode change\n');
    git('mv', 'old.ts', 'new.ts');
    git('add', '.');
    git('commit', '-m', 'changes');
    assert.deepEqual(parseUnifiedDiff(await getDiff({ kind: 'revision', base: 'HEAD~1', target: 'HEAD' }, repo, ['selected file.ts'])).map((file) => file.path), ['selected file.ts']);
    assert.deepEqual(parseUnifiedDiff(await getDiff({ kind: 'revision', base: 'HEAD~1', target: 'HEAD' }, repo, ['中文.ts'])).map((file) => file.path), ['中文.ts']);
    for (const path of ['old.ts', 'new.ts']) {
      const files = parseUnifiedDiff(await getDiff({ kind: 'revision', base: 'HEAD~1', target: 'HEAD' }, repo, [path]));
      assert.equal(files.length, 1);
      assert.equal(files[0].status, 'renamed');
      assert.equal(files[0].oldPath, 'old.ts');
      assert.equal(files[0].path, 'new.ts');
    }
    await writeFile(join(repo, 'selected file.ts'), 'staged change\n');
    await writeFile(join(repo, 'other.ts'), 'unrelated staged\n');
    git('add', '.');
    await writeFile(join(repo, 'selected file.ts'), 'working change\n');
    await writeFile(join(repo, 'other.ts'), 'unrelated working\n');
    await writeFile(join(repo, '未跟踪 file.ts'), 'new file\n');
    for (const mode of [{ kind: 'working' }, { kind: 'working', base: 'HEAD' }, { kind: 'staged' }] as const) {
      assert.deepEqual(parseUnifiedDiff(await getDiff(mode, repo, ['selected file.ts'])).map((file) => file.path), ['selected file.ts']);
      assert.equal(await getDiff(mode, repo, ['unchanged.ts']), '');
      assert.equal(await getDiff(mode, repo, []), '');
      assert.ok(parseUnifiedDiff(await getDiff(mode, repo)).some((file) => file.path === 'other.ts'));
    }
    assert.deepEqual(parseUnifiedDiff(await getDiff({ kind: 'working' }, repo, ['未跟踪 file.ts'])).map((file) => file.path), ['未跟踪 file.ts']);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
