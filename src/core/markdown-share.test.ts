/**
 * 独立 Markdown 分享快照测试：覆盖文件类型、仓库边界和门户配置。
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMarkdownShareSnapshot } from './markdown-share';

test('为仓库内 Markdown 构建独立分享快照', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'diff-review-share-'));
  try {
    await mkdir(join(repo, 'docs'));
    await writeFile(join(repo, 'docs', 'guide.md'), '# Guide\n', 'utf8');
    const snapshot = await buildMarkdownShareSnapshot(repo, 'docs/guide.md', 'https://reviews.example.test/share?x=1');
    assert.equal(snapshot.session.reviewKind, 'markdown-share');
    assert.equal(snapshot.session.shareBaseUrl, 'https://reviews.example.test/share');
    assert.equal(snapshot.diffFiles[0].path, 'docs/guide.md');
    assert.equal(snapshot.virtualFiles['docs/guide.md'], '# Guide\n');
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('拒绝非 Markdown 和通过符号链接逃逸仓库的文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'diff-review-share-'));
  const repo = join(root, 'repo');
  const outside = join(root, 'outside.md');
  try {
    await mkdir(repo);
    await writeFile(join(repo, 'notes.txt'), 'notes', 'utf8');
    await writeFile(outside, '# Outside', 'utf8');
    await symlink(outside, join(repo, 'linked.md'));
    await assert.rejects(() => buildMarkdownShareSnapshot(repo, 'notes.txt'), /only supports/);
    await assert.rejects(() => buildMarkdownShareSnapshot(repo, 'linked.md'), /inside the repository/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
