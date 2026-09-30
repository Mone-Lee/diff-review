/**
 * Markdown 分享协议测试：覆盖 Unicode 往返、输入校验、URL 限制与安全基址。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildShareUrl,
  decodeSharePayload,
  encodeSharePayload,
  parseShareUrl,
  type MarkdownSharePayload
} from './share';

function payload(): MarkdownSharePayload {
  return {
    version: 1,
    shareId: 'share-1',
    title: '评审 📘',
    filePath: 'docs/计划.md',
    markdown: '# 计划\n\n| 项目 | 状态 |\n| --- | --- |\n| 分享 | ✅ |',
    contentHash: 'digest-1',
    threads: [
      {
        id: 'thread-1',
        anchor: { type: 'markdown-line', filePath: 'docs/计划.md', lineNumber: 1, blockId: 'heading-计划' },
        comments: [
          {
            id: 'comment-1',
            body: '请补充边界 🙂',
            authorName: '小李',
            createdAt: '2026-09-28T00:00:00.000Z',
            source: 'reviewer',
            reviewerId: 'reviewer-1'
          }
        ]
      }
    ]
  };
}

test('分享载荷支持 Unicode 和 GFM 内容往返', async () => {
  const encoded = await encodeSharePayload(payload());
  assert.deepEqual(await decodeSharePayload(encoded), payload());
});

test('分享 URL 使用 fragment 且可以恢复载荷', async () => {
  const url = await buildShareUrl('https://reviews.example.test/share?ignored=1#old', payload());
  assert.match(url, /^https:\/\/reviews\.example\.test\/share#share=/);
  assert.deepEqual(await parseShareUrl(url), payload());
});

test('拒绝未知版本、越界锚点和非 http 门户', async () => {
  await assert.rejects(() => encodeSharePayload({ ...payload(), version: 2 as 1 }), /版本/);
  const invalidLine = payload();
  invalidLine.threads[0].anchor = { type: 'markdown-line', filePath: invalidLine.filePath, lineNumber: 99 };
  await assert.rejects(() => encodeSharePayload(invalidLine), /超出文档范围/);
  await assert.rejects(() => buildShareUrl('javascript:alert(1)', payload()), /http/);
});

test('拒绝超过 32 KiB 的完整链接', async () => {
  const large = payload();
  large.markdown = Array.from({ length: 8_000 }, (_, index) => `${index}-${crypto.randomUUID()}`).join('\n');
  await assert.rejects(() => buildShareUrl('https://reviews.example.test/', large), /32 KiB/);
});
