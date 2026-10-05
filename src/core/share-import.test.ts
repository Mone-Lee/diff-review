/**
 * 分享反馈导入测试：覆盖多人合并、重复导入、快照隔离与本地评论保留。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MarkdownSharePayload } from '../shared/share';
import type { DiffFile } from '../shared/types';
import { importShareFeedback, type ShareImportStore } from './share-import';
import { formatPrompt } from './prompt';

const file: DiffFile = {
  oldPath: '/dev/null',
  newPath: 'docs/spec.md',
  path: 'docs/spec.md',
  snapshotHash: 'snapshot-1',
  status: 'added',
  additions: 2,
  deletions: 0,
  isMarkdown: true,
  hunks: []
};

function feedback(commentId: string, reviewerId: string, name: string): MarkdownSharePayload {
  return {
    version: 1,
    shareId: 'share-1',
    title: 'spec.md',
    filePath: file.path,
    markdown: '# Spec\nBody',
    contentHash: 'digest-1',
    threads: [{
      id: `thread-${commentId}`,
      status: 'submit',
      anchor: { type: 'markdown-line', filePath: file.path, lineNumber: 1 },
      comments: [{
        id: commentId,
        body: `Feedback ${commentId}`,
        authorName: name,
        createdAt: '2026-09-28T00:00:00.000Z',
        source: 'reviewer',
        reviewerId
      }]
    }]
  };
}

test('把多位审阅者反馈合并到同一锚点并对未变化的链接去重', () => {
  const store: ShareImportStore = { threads: [] };
  const resolvedFeedback = feedback('comment-a', 'reviewer-a', 'Alice');
  resolvedFeedback.threads[0].status = 'resolved';
  assert.deepEqual(importShareFeedback(store, resolvedFeedback, file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 1, updated: 0, skipped: 0 });
  assert.deepEqual(importShareFeedback(store, feedback('comment-b', 'reviewer-b', 'Bob'), file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 1, updated: 0, skipped: 0 });
  assert.deepEqual(importShareFeedback(store, feedback('comment-a', 'reviewer-a', 'Alice'), file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 0, updated: 0, skipped: 1 });
  const reshared = feedback('comment-a', 'reviewer-a', 'Alice');
  reshared.shareId = 'share-2';
  reshared.threads[0].comments[0].originShareId = 'share-1';
  assert.deepEqual(importShareFeedback(store, reshared, file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 0, updated: 0, skipped: 1 });
  assert.equal(store.threads.length, 1);
  assert.equal(store.threads[0].status, 'submit');
  assert.deepEqual(store.threads[0].comments.map((comment) => [comment.author, comment.authorName]), [
    ['reviewer', 'Alice'],
    ['reviewer', 'Bob']
  ]);
  assert.match(formatPrompt(store.threads), /\[Reviewer: Alice\]/);
  assert.match(formatPrompt(store.threads), /Reply 1 \(Reviewer: Bob\)/);
});

test('再次导入时更新同一审阅者修改过的评论', () => {
  const store: ShareImportStore = { threads: [] };
  const original = feedback('comment-a', 'reviewer-a', 'Alice');
  assert.deepEqual(importShareFeedback(store, original, file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 1, updated: 0, skipped: 0 });

  const edited = feedback('comment-a', 'reviewer-a', 'Alice Updated');
  edited.threads[0].comments[0].body = 'Updated feedback';
  assert.deepEqual(importShareFeedback(store, edited, file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 0, updated: 1, skipped: 0 });
  assert.equal(store.threads.length, 1);
  assert.equal(store.threads[0].comments.length, 1);
  assert.equal(store.threads[0].comments[0].body, 'Updated feedback');
  assert.equal(store.threads[0].comments[0].authorName, 'Alice Updated');
});

test('不同审阅者使用相同评论 ID 时分别导入', () => {
  const store: ShareImportStore = { threads: [] };
  assert.deepEqual(importShareFeedback(store, feedback('comment-a', 'reviewer-a', 'Alice'), file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 1, updated: 0, skipped: 0 });
  assert.deepEqual(importShareFeedback(store, feedback('comment-a', 'reviewer-b', 'Bob'), file, '# Spec\nBody', 'digest-1', 'review-1'), { imported: 1, updated: 0, skipped: 0 });
  assert.deepEqual(store.threads[0].comments.map((comment) => comment.authorName), ['Alice', 'Bob']);
});

test('拒绝不同内容摘要或正文的反馈链接', () => {
  const store: ShareImportStore = { threads: [] };
  assert.throws(() => importShareFeedback(store, feedback('comment-a', 'reviewer-a', 'Alice'), file, '# Changed', 'digest-1', 'review-1'), /SHARE_SNAPSHOT_MISMATCH/);
  assert.throws(() => importShareFeedback(store, feedback('comment-a', 'reviewer-a', 'Alice'), file, '# Spec\nBody', 'digest-2', 'review-1'), /SHARE_SNAPSHOT_MISMATCH/);
});
