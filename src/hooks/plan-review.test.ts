/**
 * Plan review hook 的回归测试：覆盖 Codex collaboration mode 识别和 turn 隔离。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildPlanReviewSnapshot,
  formatCodexStopHookOutput,
  formatPlanHookOutput,
  type CodexHookInput
} from './plan-review';

async function withTranscript(records: unknown[], run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'diff-review-plan-test-'));
  const path = join(directory, 'rollout.jsonl');
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  try {
    await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function collaborationPlanRecords(turnId: string, planText: string): unknown[] {
  return [
    {
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: turnId,
        collaboration_mode_kind: 'plan'
      }
    },
    {
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        turn_id: turnId,
        item: {
          type: 'Plan',
          text: planText
        }
      }
    }
  ];
}

test('识别当前 turn 的 collaboration mode 计划', async () => {
  await withTranscript(collaborationPlanRecords('turn-current', '# 新版计划'), async (transcriptPath) => {
    const input: CodexHookInput = {
      hook_event_name: 'Stop',
      session_id: 'session-current',
      turn_id: 'turn-current',
      transcript_path: transcriptPath
    };

    const snapshot = await buildPlanReviewSnapshot(input, process.cwd(), { source: 'codex' });

    assert.equal(snapshot?.planText, '# 新版计划');
    assert.equal(snapshot?.session.planReviewSource, 'codex');
  });
});

test('不使用其他 turn 的 collaboration mode 计划', async () => {
  await withTranscript(collaborationPlanRecords('turn-old', '# 历史计划'), async (transcriptPath) => {
    const input: CodexHookInput = {
      hook_event_name: 'Stop',
      session_id: 'session-current',
      turn_id: 'turn-current',
      transcript_path: transcriptPath
    };

    const snapshot = await buildPlanReviewSnapshot(input, process.cwd());

    assert.equal(snapshot, null);
  });
});

test('Codex Stop hook 使用 block reason 退回评论', () => {
  const output = formatCodexStopHookOutput(
    {
      decision: 'changes-requested',
      feedback: '补充回滚方案',
      decidedAt: '2026-08-15T00:00:00.000Z'
    },
    []
  );

  assert.deepEqual(output, {
    decision: 'block',
    reason: '补充回滚方案',
    systemMessage: 'Plan changes requested in Diff Review.'
  });
});

test('Codex Stop hook 通过计划时允许当前 turn 结束', () => {
  const output = formatCodexStopHookOutput(
    {
      decision: 'approved',
      decidedAt: '2026-08-15T00:00:00.000Z'
    },
    []
  );

  assert.deepEqual(output, {
    continue: true,
    systemMessage: 'Plan approved in Diff Review.'
  });
});

test('Copilot 继续使用 continue stopReason 退回评论', () => {
  const output = formatPlanHookOutput(
    {
      decision: 'changes-requested',
      feedback: '补充回滚方案',
      decidedAt: '2026-08-15T00:00:00.000Z'
    },
    []
  );

  assert.deepEqual(output, {
    continue: false,
    stopReason: '补充回滚方案',
    systemMessage: 'Plan changes requested in Diff Review.'
  });
});
