/**
 * 分享反馈草稿测试：覆盖同源恢复、新链接隔离、自动清理与存储失败降级。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { MarkdownSharePayload } from '../shared/share';
import { restoreShareDraft, saveShareDraft } from './share-draft';

function createPayload(body = '原评论', shareId = 'share-1'): MarkdownSharePayload {
  return {
    version: 1,
    shareId,
    title: 'spec.md',
    filePath: 'docs/spec.md',
    markdown: '# Spec',
    contentHash: 'hash-1',
    threads: [{
      id: 'thread-1',
      anchor: { type: 'markdown-line', filePath: 'docs/spec.md', lineNumber: 1 },
      comments: [{
        id: 'comment-1',
        body,
        authorName: 'Alice',
        createdAt: '2026-10-03T00:00:00.000Z',
        source: 'reviewer',
        reviewerId: 'reviewer-1'
      }]
    }]
  };
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    values
  };
}

test('刷新同一分享链接时恢复评论草稿', () => {
  const storage = createStorage();
  const base = createPayload();
  const current = createPayload('修改后的评论');

  assert.equal(saveShareDraft(base, current, 'reviewer-1', storage), true);
  const restored = restoreShareDraft(base, 'reviewer-1', storage);
  assert.equal(restored.restored, true);
  assert.equal(restored.payload.threads[0].comments[0].body, '修改后的评论');
});

test('原始线程变化后忽略旧草稿', () => {
  const storage = createStorage();
  const base = createPayload();
  assert.equal(saveShareDraft(base, createPayload('草稿评论'), 'reviewer-1', storage), true);

  const newerLink = createPayload('另一位审阅者返回的新评论');
  assert.deepEqual(restoreShareDraft(newerLink, 'reviewer-1', storage), { payload: newerLink, restored: false });
});

test('读取草稿时删除超过 30 天的记录', () => {
  const storage = createStorage();
  const payload = createPayload();
  const now = Date.UTC(2026, 9, 3);
  assert.equal(saveShareDraft(payload, createPayload('草稿评论'), 'reviewer-1', storage, now - 31 * 24 * 60 * 60 * 1_000), true);

  assert.deepEqual(restoreShareDraft(payload, 'reviewer-1', storage, now), { payload, restored: false });
  assert.equal(storage.length, 0);
});

test('仅保留最近更新的 20 份草稿', () => {
  const storage = createStorage();
  const now = Date.UTC(2026, 9, 3);
  for (let index = 0; index < 21; index += 1) {
    const payload = createPayload(`评论 ${index}`, `share-${index}`);
    assert.equal(saveShareDraft(payload, payload, 'reviewer-1', storage, now + index), true);
  }

  assert.equal(storage.length, 20);
  assert.equal([...storage.values.keys()].some((key) => key.includes(':share-0:')), false);
});

test('存储不可用时返回失败且不影响页面状态', () => {
  const unavailableStorage = {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => undefined
  };

  assert.equal(saveShareDraft(createPayload(), createPayload('草稿评论'), 'reviewer-1', unavailableStorage), false);
});
