/**
 * Web 格式化工具测试：覆盖评论锚点在单文件精简场景下的展示文本。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReviewThread } from '../shared/types';
import { formatAnchorLocation } from './utils';

function createThread(anchor: ReviewThread['anchor']): ReviewThread {
  return {
    id: 'thread-1',
    filePath: anchor.filePath,
    anchor,
    status: 'submit',
    comments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

test('formatAnchorLocation omits the file path while preserving markdown locations', () => {
  assert.equal(formatAnchorLocation(createThread({ type: 'file', filePath: 'plan.md' })), '全文');
  assert.equal(formatAnchorLocation(createThread({ type: 'markdown-line', filePath: 'plan.md', lineNumber: 25 })), '第 25 行');
  assert.equal(formatAnchorLocation(createThread({
    type: 'markdown-selection',
    filePath: 'plan.md',
    startLine: 25,
    endLine: 27,
    startOffset: 0,
    endOffset: 8,
    selectedText: 'selection'
  })), '第 25-27 行');
});

test('formatAnchorLocation distinguishes old and new diff lines', () => {
  assert.equal(formatAnchorLocation(createThread({ type: 'diff-line', filePath: 'plan.md', side: 'old', lineNumber: 8 })), '旧版本 · 第 8 行');
  assert.equal(formatAnchorLocation(createThread({ type: 'diff-line', filePath: 'plan.md', side: 'new', lineNumber: 9 })), '新版本 · 第 9 行');
});
