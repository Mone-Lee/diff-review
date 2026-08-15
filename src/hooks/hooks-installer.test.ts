/**
 * Hook 安装器回归测试：验证 Codex plan review 只安装 Stop hook，并清理本工具曾写入的旧 hook。
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installCodexPlanHook } from './hooks-installer';

const planHookCommand = 'npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest plan-hook';
const preToolHookCommand = 'npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest codex-pre-tool-plan';
const permissionHookCommand = 'npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest codex-permission-plan';

test('Codex hook installer installs Stop hook and removes obsolete Diff Review hooks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'diff-review-hooks-test-'));
  const codexDir = join(directory, '.codex');
  await mkdir(codexDir, { recursive: true });
  await writeFile(
    join(codexDir, 'hooks.json'),
    `${JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'existing-stop' }] }],
        PreToolUse: [
          {
            matcher: '.*',
            hooks: [
              { type: 'command', command: preToolHookCommand },
              { type: 'command', command: 'existing-pre-tool' }
            ]
          }
        ],
        PermissionRequest: [{ matcher: '.*', hooks: [{ type: 'command', command: permissionHookCommand }] }]
      }
    })}\n`,
    'utf8'
  );

  try {
    const result = await installCodexPlanHook({ project: true, cwd: directory });
    const nextHooks = JSON.parse(await readFile(result.path, 'utf8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    assert.equal(result.changed, true);
    assert.equal(nextHooks.hooks.Stop.some((group) => group.hooks.some((hook) => hook.command === planHookCommand)), true);
    assert.equal(nextHooks.hooks.PreToolUse.some((group) => group.hooks.some((hook) => hook.command === preToolHookCommand)), false);
    assert.equal(nextHooks.hooks.PreToolUse.some((group) => group.hooks.some((hook) => hook.command === 'existing-pre-tool')), true);
    assert.equal('PermissionRequest' in nextHooks.hooks, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
