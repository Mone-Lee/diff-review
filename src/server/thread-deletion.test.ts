/**
 * 评论线程删除接口测试：验证主审阅服务可以删除包含导入 reviewer 评论的线程。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

test('主审阅服务可删除包含导入 reviewer 评论的线程', { timeout: 15_000 }, async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'diff-review-thread-delete-'));
  const repoRoot = join(fixtureRoot, 'repo');
  const homeRoot = join(fixtureRoot, 'home');
  const storeDir = join(homeRoot, '.local', 'diff-review', 'logs');
  const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
  const storePath = join(storeDir, `${basename(repoRoot)}-${repoHash}.comments.json`);
  await mkdir(repoRoot);
  await mkdir(storeDir, { recursive: true });
  await writeFile(storePath, JSON.stringify({
    threads: [{
      id: 'reviewer-thread',
      filePath: 'review.md',
      anchor: { type: 'file', filePath: 'review.md' },
      status: 'submit',
      comments: [{
        id: 'reviewer-comment',
        body: 'Imported feedback',
        author: 'reviewer',
        authorName: 'Reviewer B',
        createdAt: '2026-10-12T00:00:00.000Z',
        updatedAt: '2026-10-12T00:00:00.000Z'
      }],
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z'
    }]
  }));

  const session = {
    id: 'thread-delete', repoName: 'fixture', repoRoot,
    mode: { kind: 'working' }, diffHash: 'hash', createdAt: '2026-10-12T00:00:00.000Z'
  };
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { startServer } from ${JSON.stringify(new URL('./index.ts', import.meta.url).href)};
    console.log(await startServer(${JSON.stringify({ session, diffFiles: [] })}, 0));
  `], {
    env: { ...process.env, HOME: homeRoot },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const lines = createInterface({ input: child.stdout });

  try {
    const [url] = await once(lines, 'line') as [string];
    const response = await fetch(`${url}/api/threads/reviewer-thread`, { method: 'DELETE' });
    assert.equal(response.status, 204);
    const store = JSON.parse(await readFile(storePath, 'utf8')) as { threads: unknown[] };
    assert.deepEqual(store.threads, []);
  } finally {
    lines.close();
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
