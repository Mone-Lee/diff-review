/**
 * 分享门户集成测试：验证源码运行时保留公网门户地址，同时继续提供本地分享资源预览。
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('源码运行时保留公网分享门户并托管本地分享资源', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'diff-review-share-server-'));
  const webDist = join(root, 'web');
  const shareDist = join(root, 'share');
  await mkdir(webDist);
  await mkdir(join(shareDist, 'assets'), { recursive: true });
  await writeFile(join(webDist, 'index.html'), '<main>Main review</main>');
  await writeFile(join(shareDist, 'share.html'), '<main>Shared review</main>');
  await writeFile(join(shareDist, 'assets/share.js'), '/* share bundle */');
  await execFileAsync('git', ['init'], { cwd: root });
  await writeFile(join(root, 'review.md'), '# Review\n');
  const session = {
    id: 'local-share', repoName: 'fixture', repoRoot: root,
    mode: { kind: 'working' }, diffHash: 'hash', createdAt: new Date().toISOString(),
    shareId: 'share-id', shareBaseUrl: 'https://mone-lee.github.io/diff-review/share.html'
  };
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { startServer } from ${JSON.stringify(new URL('./index.ts', import.meta.url).href)};
    console.log(await startServer(${JSON.stringify({ session, diffFiles: [], webDist })}, 0));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  try {
    const [url] = await once(lines, 'line') as [string];
    const response = await fetch(`${url}/api/session`);
    const clientSession = await response.json() as typeof session;
    assert.equal(clientSession.shareBaseUrl, session.shareBaseUrl);
    assert.equal(clientSession.shareId, session.shareId);
    const reviewState = await (await fetch(`${url}/api/review-state`)).json() as { session: typeof session };
    assert.equal(reviewState.session.shareBaseUrl, session.shareBaseUrl);
    const refreshedState = await (await fetch(`${url}/api/refresh`, { method: 'POST' })).json() as { session: typeof session };
    assert.equal(refreshedState.session.shareBaseUrl, session.shareBaseUrl);
    assert.equal(refreshedState.session.shareId, session.shareId);
    const share = await fetch(`${url}/share.html`);
    assert.equal(share.status, 200);
    assert.equal(await share.text(), '<main>Shared review</main>');
    assert.equal(share.headers.get('cache-control'), 'no-cache');
    assert.equal(await (await fetch(`${url}/assets/share.js`)).text(), '/* share bundle */');
    assert.equal(await (await fetch(url)).text(), '<main>Main review</main>');
    await rm(join(shareDist, 'share.html'));
    assert.equal((await fetch(`${url}/share.html`)).status, 404);
  } finally {
    lines.close();
    const stopped = once(child, 'exit');
    child.kill('SIGTERM');
    await stopped;
    await rm(root, { recursive: true, force: true });
  }
});
