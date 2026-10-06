/**
 * Markdown 分享协议测试：覆盖 Unicode 往返、输入校验、URL 限制与安全基址。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DiffFile, ReviewSession, ReviewThread } from './types';
import {
  buildShareUrl,
  decodeSharePayload,
  encodeSharePayload,
  getShareUrlCapacity,
  getShareableMarkdownFile,
  parseShareUrl,
  reviewThreadsToShareThreads,
  validateSharePayload,
  type MarkdownSharePayload
} from './share';

function reviewSession(selectedFiles?: string[]): ReviewSession {
  return {
    id: 'session-1',
    repoName: 'repo',
    repoRoot: '/repo',
    mode: { kind: 'working' },
    selectedFiles,
    diffHash: 'diff-1',
    createdAt: '2026-09-28T00:00:00.000Z'
  };
}

function diffFile(path: string, isMarkdown: boolean): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    path,
    snapshotHash: `hash-${path}`,
    status: 'modified',
    additions: 1,
    deletions: 0,
    isMarkdown,
    hunks: []
  };
}

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
        status: 'resolved',
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

test('旧版链接缺少线程状态时按待提交恢复', () => {
  const legacyPayload = payload() as unknown as { threads: Array<Record<string, unknown>> };
  delete legacyPayload.threads[0].status;

  assert.equal(validateSharePayload(legacyPayload).threads[0].status, 'submit');
});

test('分享线程保留主审阅页的真实状态', () => {
  const thread: ReviewThread = {
    id: 'thread-replied',
    filePath: 'docs/计划.md',
    anchor: { type: 'markdown-line', filePath: 'docs/计划.md', lineNumber: 1 },
    status: 'replied',
    comments: [],
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z'
  };

  assert.equal(reviewThreadsToShareThreads([thread])[0].status, 'replied');
});

test('分享载荷保留单行和跨行选区评论锚点', async () => {
  const selectionAnchors = [
    {
      type: 'markdown-selection' as const,
      filePath: 'docs/计划.md',
      startLine: 1,
      endLine: 1,
      startOffset: 0,
      endOffset: 2,
      selectedText: '计划',
      sourceStartLine: 1,
      sourceEndLine: 1
    },
    {
      type: 'markdown-selection' as const,
      filePath: 'docs/计划.md',
      startLine: 3,
      endLine: 5,
      startOffset: 0,
      endOffset: 2,
      selectedText: '项目 状态 分享 ✅',
      sourceStartLine: 3,
      sourceEndLine: 5,
      tableColumn: 1
    }
  ];
  const threads: ReviewThread[] = selectionAnchors.map((anchor, index) => ({
    id: `selection-${index}`,
    filePath: anchor.filePath,
    anchor,
    status: 'submit',
    comments: [],
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z'
  }));
  const sharedThreads = reviewThreadsToShareThreads(threads);
  const sharedPayload = { ...payload(), threads: sharedThreads };

  assert.deepEqual(sharedThreads.map((thread) => thread.anchor), selectionAnchors);
  assert.deepEqual((await decodeSharePayload(await encodeSharePayload(sharedPayload))).threads, sharedThreads);
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

test('编码与解码使用一致的 2 MiB 内容限制', async () => {
  const large = payload();
  large.threads[0].comments = Array.from({ length: 110 }, (_, index) => ({
    ...large.threads[0].comments[0],
    id: `comment-${index}`,
    body: 'a'.repeat(20_000)
  }));

  await assert.rejects(() => encodeSharePayload(large), /2 MiB/);
});

test('损坏的压缩数据不会产生额外的未处理拒绝', async () => {
  const unhandledReasons: unknown[] = [];
  const captureUnhandledRejection = (reason: unknown) => unhandledReasons.push(reason);
  process.on('unhandledRejection', captureUnhandledRejection);

  try {
    await assert.rejects(() => decodeSharePayload('AAAA'), /分享链接内容无效或已损坏/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandledReasons, []);
  } finally {
    process.off('unhandledRejection', captureUnhandledRejection);
  }
});

test('报告完整分享链接的已用和剩余容量', async () => {
  const url = await buildShareUrl('https://reviews.example.test/', payload());
  const capacity = getShareUrlCapacity(url);

  assert.equal(capacity.usedBytes, new TextEncoder().encode(url).byteLength);
  assert.equal(capacity.remainingBytes, capacity.limitBytes - capacity.usedBytes);
  assert.ok(capacity.remainingBytes > 0);
});

test('仅为单一 Markdown 快照提供分享入口', () => {
  const markdown = diffFile('docs/plan.md', true);
  const source = diffFile('src/app.ts', false);

  assert.equal(getShareableMarkdownFile(reviewSession(), [markdown]), markdown);
  assert.equal(getShareableMarkdownFile(reviewSession(['docs/plan.md']), [markdown]), markdown);
  assert.equal(getShareableMarkdownFile(reviewSession(), [markdown, source]), null);
  assert.equal(getShareableMarkdownFile(reviewSession(), [source]), null);
});
