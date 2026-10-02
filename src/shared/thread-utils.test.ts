/**
 * 评论范围回归测试：验证当前 diff 的文件筛选，并保留相关文件的历史快照评论。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { selectThreadsForDiffFiles } from './thread-utils';
import type { DiffFile, ReviewThread } from './types';

function file(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, oldPath: path, newPath: path, status, snapshotHash: 'current', additions: 0, deletions: 0, isMarkdown: false, hunks: [] };
}

function thread(id: string, filePath: string, fileSnapshotHash = 'current'): ReviewThread {
  return {
    id, filePath, fileSnapshotHash, anchor: { type: 'file', filePath },
    status: 'submit', comments: [], createdAt: '', updatedAt: ''
  };
}

test('仅返回当前修改文件的评论，保留相关历史快照且不修改原始评论', () => {
  const threads = [thread('current', 'a.ts'), thread('history', 'a.ts', 'previous'), thread('unrelated', 'b.ts')];
  const original = structuredClone(threads);
  assert.deepEqual(selectThreadsForDiffFiles(threads, [file('a.ts')]).map((item) => item.id), ['current', 'history']);
  assert.deepEqual(threads, original);
});

test('没有修改文件时不返回评论，切换范围后使用新的文件集合', () => {
  const threads = [thread('a', 'a.ts'), thread('b', 'b.ts')];
  assert.deepEqual(selectThreadsForDiffFiles(threads, []), []);
  assert.deepEqual(selectThreadsForDiffFiles(threads, [file('b.ts')]), [threads[1]]);
});

test('新增、删除和重命名文件均按 diff 的规范路径加载评论', () => {
  const files = [file('added.ts', 'added'), file('deleted.ts', 'deleted'), { ...file('new.ts', 'renamed'), oldPath: 'old.ts' }];
  const threads = [thread('added', 'added.ts'), thread('deleted', 'deleted.ts'), thread('renamed', 'new.ts'), thread('other', 'other.ts')];
  assert.deepEqual(selectThreadsForDiffFiles(threads, files), threads.slice(0, 3));
});
