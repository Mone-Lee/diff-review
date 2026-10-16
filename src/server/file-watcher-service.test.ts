/**
 * 文件监听服务测试：验证磁盘事件只有在审查范围的 diff 确实变化时才会通知前端。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Response } from 'express';
import { FileWatcherService } from './file-watcher-service';

test('忽略未改变审查 diff 的文件系统事件', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'diff-review-watcher-'));
  const gitObjects = join(repoRoot, '.git', 'objects');
  await mkdir(gitObjects, { recursive: true });
  const events: string[] = [];
  let hasReviewChanges = false;
  const watcher = new FileWatcherService(repoRoot, async () => hasReviewChanges);
  const response = {
    write(chunk: string) {
      events.push(chunk);
    },
    on() {},
    end() {}
  } as unknown as Response;

  watcher.subscribe(response);

  try {
    await writeFile(join(gitObjects, 'internal-snapshot'), 'noise');
    await wait(350);
    assert.equal(events.some((event) => event.includes('"type":"change"')), false);

    hasReviewChanges = true;
    await writeFile(join(repoRoot, 'reviewed-file.ts'), 'changed');
    await waitFor(() => events.some((event) => event.includes('"type":"change"')));
  } finally {
    watcher.dispose();
    await rm(repoRoot, { recursive: true, force: true });
  }
});

function wait(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for file watcher event');
    await wait(20);
  }
}
