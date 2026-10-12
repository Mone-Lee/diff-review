/**
 * Review API 请求测试：验证评论删除失败会携带服务端详情抛出，供界面统一提示。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteReviewComment, deleteReviewThread } from './api/review';

test('删除评论线程失败时抛出服务端错误详情', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ error: 'Imported reviewer comments are read-only' }),
    { status: 400, statusText: 'Bad Request' }
  ));

  await assert.rejects(
    deleteReviewThread('thread-id'),
    /删除评论线程失败 \(400 Bad Request\): Imported reviewer comments are read-only/
  );
});

test('删除单条评论失败时抛出服务端错误详情', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ error: 'Agent comments are read-only' }),
    { status: 400, statusText: 'Bad Request' }
  ));

  await assert.rejects(
    deleteReviewComment('thread-id', 'comment-id'),
    /删除评论失败 \(400 Bad Request\): Agent comments are read-only/
  );
});
