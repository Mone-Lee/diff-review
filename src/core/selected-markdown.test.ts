/**
 * 选中 Markdown 补全测试：确保无变更 Markdown 仍能进入预览，而其他选中文件不改变空状态。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { DiffFile, ReviewMode } from '../shared/types';
import { includeSelectedMarkdownFiles } from './selected-markdown';

const workingMode: ReviewMode = { kind: 'working' };

function diffFile(path: string): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    path,
    snapshotHash: 'existing',
    status: 'modified',
    additions: 1,
    deletions: 0,
    isMarkdown: true,
    hunks: []
  };
}

test('为无变更的选中 Markdown 创建零变更审查文件', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'diff-review-selected-markdown-'));
  try {
    await writeFile(join(repo, 'guide.md'), '# Guide\n', 'utf8');
    await writeFile(join(repo, 'readme.markdown'), '# Readme\n', 'utf8');
    const files = await includeSelectedMarkdownFiles([], ['guide.md', 'readme.markdown'], workingMode, repo);

    assert.deepEqual(files.map((file) => file.path), ['guide.md', 'readme.markdown']);
    assert.ok(files.every((file) => file.isMarkdown && file.hunks.length === 0));
    assert.ok(files.every((file) => file.additions === 0 && file.deletions === 0));
    await writeFile(join(repo, 'guide.md'), '# Updated guide\n', 'utf8');
    const updatedFiles = await includeSelectedMarkdownFiles([], ['guide.md'], workingMode, repo);
    assert.notEqual(files[0].snapshotHash, updatedFiles[0].snapshotHash);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('不为非 Markdown 添加文件，也不重复已有 diff 文件', async () => {
  const existing = diffFile('docs/guide.md');
  const files = await includeSelectedMarkdownFiles([existing], ['docs/guide.md', 'src/app.ts'], workingMode, '/not-read');

  assert.deepEqual(files, [existing]);
});
