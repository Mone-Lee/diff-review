/** 验证选区评论向 Agent 提供源码位置与未经空白折叠的文本，并兼容旧锚点。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPrompt } from './prompt';
import type { ReviewThread } from '../shared/types';

const thread: ReviewThread = {
  id: 'selection', filePath: 'guide.md', fileSnapshotHash: 'snapshot', status: 'submit',
  createdAt: '', updatedAt: '',
  anchor: {
    type: 'markdown-selection', filePath: 'guide.md', startLine: 6, endLine: 6,
    startOffset: 2, endOffset: 9, selectedText: 'a  b\nc',
    sourceStartLine: 8, sourceEndLine: 9, tableColumn: 2
  },
  comments: [{ id: 'comment', body: '修改这部分', createdAt: '', updatedAt: '' }]
};

test('选区 prompt 使用源码行、列号与保留空白的文本', () => {
  const prompt = formatPrompt([thread]);
  assert.match(prompt, /guide\.md:8-9/);
  assert.match(prompt, /Table column: 2/);
  assert.ok(prompt.includes(JSON.stringify('a  b\nc')));
  assert.match(prompt, /^Markdown selections:/);
});

test('多个选区线程只输出一次公共定位规则', () => {
  const prompt = formatPrompt([thread, { ...thread, id: 'selection-2' }]);
  assert.equal(prompt.match(/Markdown selections:/g)?.length, 1);
  assert.equal(prompt.match(/Selected \(JSON\):/g)?.length, 2);
});

test('旧选区锚点仍可输出，块评论不增加选区指令', () => {
  const anchor = { ...thread.anchor };
  if (anchor.type !== 'markdown-selection') throw new Error('fixture');
  delete anchor.sourceStartLine;
  delete anchor.sourceEndLine;
  assert.match(formatPrompt([{ ...thread, anchor }]), /guide\.md:6\n/);
  const prompt = formatPrompt([{ ...thread, anchor: { type: 'markdown-line', filePath: 'guide.md', lineNumber: 6 } }]);
  assert.equal(prompt, '[thread:selection]\nguide.md:6\n修改这部分');
});
