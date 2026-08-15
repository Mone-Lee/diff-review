/**
 * Plan review 工具：把 Codex/Copilot/Qoder hook 输入里的计划文本整理为虚拟 Markdown diff，并生成 hook 返回值。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { DiffFile, PlanReviewResult, ReviewSession, ReviewThread } from '../shared/types';
import { formatPrompt } from '../core/prompt';

export type CodexHookInput = {
  cwd?: unknown;
  hook_event_name?: unknown;
  transcript_path?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
  tool_name?: unknown;
  last_assistant_message?: unknown;
};

export type PlanReviewSnapshot = {
  session: ReviewSession;
  diffFiles: DiffFile[];
  virtualFiles: Record<string, string>;
  planPath: string;
  planText: string;
};

export type PlanHookOutput = {
  continue: boolean;
  stopReason?: string;
  systemMessage?: string;
};

export type CodexStopHookOutput = {
  continue?: true;
  decision?: 'block';
  reason?: string;
  systemMessage?: string;
};

export type CodexPreToolUseOutput = {
  systemMessage?: string;
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision?: 'deny';
    permissionDecisionReason?: string;
  };
};

export type PlanReviewSnapshotOptions = {
  requireCodexPlanStop?: boolean;
  requireCodexPreToolUse?: boolean;
  requireCopilotExitPlan?: boolean;
  requireQoderCreatePlan?: boolean;
};

// 计划审查不会落真实仓库文件；这个前缀只用于在 Diff Review UI 中标识虚拟 Markdown 快照。
const PLAN_FILE_PREFIX = '.diff-review-plan';

/**
 * 从 hook 子进程 stdin 读取 Codex/Copilot 传入的 JSON payload；空输入按可放行的空对象处理。
 */
export async function readHookInputFromStdin(): Promise<CodexHookInput> {
  const text = await readStream(process.stdin);
  if (!text.trim()) return {};
  return JSON.parse(text) as CodexHookInput;
}

/**
 * 把 hook 输入转换成一次 plan review 会话；不属于目标 hook 场景或无法提取计划时返回 null 让 CLI 直接放行。
 */
export async function buildPlanReviewSnapshot(
  input: CodexHookInput,
  fallbackCwd: string,
  options: PlanReviewSnapshotOptions = {}
): Promise<PlanReviewSnapshot | null> {
  const requireCodexPlanStop = options.requireCodexPlanStop ?? true;
  const collaborationModePlan = requireCodexPlanStop ? await extractCollaborationModePlan(input) : '';
  if (requireCodexPlanStop && (input.hook_event_name !== 'Stop' || !collaborationModePlan)) {
    return null;
  }
  if (options.requireCodexPreToolUse && !isCodexPreToolPlanReviewInput(input)) return null;
  if (options.requireCopilotExitPlan && !containsExitPlanMode(input)) return null;
  if (options.requireQoderCreatePlan && !isQoderCreatePlanInput(input)) return null;

  const cwd = typeof input.cwd === 'string' && input.cwd.trim() ? resolve(input.cwd) : fallbackCwd;
  const planText = collaborationModePlan || (await extractPlanText(input));
  if (!planText) return null;
  if (options.requireCodexPreToolUse && !hasPlanReviewMarker(planText)) return null;

  const sessionId = typeof input.session_id === 'string' && input.session_id ? input.session_id : crypto.randomUUID();
  const turnId = typeof input.turn_id === 'string' && input.turn_id ? input.turn_id : crypto.randomUUID();
  // planPath 是评论绑定的关键路径：同一轮计划的评论只回流给这个虚拟文件快照。
  const planPath = `${PLAN_FILE_PREFIX}/${sessionId}-${turnId}.md`;
  const diffFiles = [createPlanDiffFile(planPath, planText)];
  const diffDigest = createHash('sha256').update(planText).digest('hex').slice(0, 16);
  const session: ReviewSession = {
    id: crypto.randomUUID(),
    repoName: basename(cwd) || 'workspace',
    repoRoot: cwd,
    mode: { kind: 'revision', base: 'agent', target: 'plan', targetLabel: 'Agent Plan' },
    diffHash: diffDigest,
    createdAt: new Date().toISOString(),
    reviewKind: 'plan'
  };

  return {
    session,
    diffFiles,
    virtualFiles: { [planPath]: planText },
    planPath,
    planText
  };
}

/**
 * 新版 Codex 将 Plan Mode 记录为当前 turn 的 collaboration mode；只接受同一 turn 的 Plan item，避免复用历史计划。
 */
async function extractCollaborationModePlan(input: CodexHookInput): Promise<string> {
  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  const turnId = typeof input.turn_id === 'string' ? input.turn_id : '';
  if (!transcriptPath || !turnId) return '';

  const records = (await readFile(transcriptPath, 'utf8'))
    .split('\n')
    .map((line) => parseJsonLine(line))
    .filter((record): record is Record<string, unknown> => Boolean(record));
  const isCurrentPlanTurn = records.some((record) => {
    const payload = asRecord(record.payload);
    return (
      record.type === 'event_msg' &&
      payload?.type === 'task_started' &&
      payload.turn_id === turnId &&
      payload.collaboration_mode_kind === 'plan'
    );
  });
  if (!isCurrentPlanTurn) return '';

  return (
    records
      .map((record) => {
        const payload = asRecord(record.payload);
        const item = asRecord(payload?.item);
        if (
          record.type !== 'event_msg' ||
          payload?.type !== 'item_completed' ||
          payload.turn_id !== turnId ||
          item?.type !== 'Plan'
        ) {
          return '';
        }
        return typeof item.text === 'string' ? item.text.trim() : '';
      })
      .filter(Boolean)
      .at(-1) ?? ''
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 根据 UI 决策生成 hook stdout：通过时继续执行，退回时把未解决评论格式化成 agent 可读反馈。
 */
export function formatPlanHookOutput(result: PlanReviewResult, threads: ReviewThread[]): PlanHookOutput {
  if (result.decision === 'approved') {
    return {
      continue: true,
      systemMessage: 'Plan approved in Diff Review.'
    };
  }

  const threadFeedback = formatPrompt(threads.filter((thread) => thread.status !== 'resolved')).trim();
  const feedback = [result.feedback?.trim(), threadFeedback].filter(Boolean).join('\n\n');
  return {
    continue: false,
    stopReason: feedback || 'Plan changes requested in Diff Review.',
    systemMessage: 'Plan changes requested in Diff Review.'
  };
}

/**
 * Codex Stop 使用 decision:block 和 reason 作为 continuation prompt；continue:false 不会把 stopReason 送回当前 agent loop。
 */
export function formatCodexStopHookOutput(result: PlanReviewResult, threads: ReviewThread[]): CodexStopHookOutput {
  if (result.decision === 'approved') {
    return {
      continue: true,
      systemMessage: 'Plan approved in Diff Review.'
    };
  }

  const feedback = formatPlanChangesRequestedFeedback(result, threads);
  return {
    decision: 'block',
    reason: feedback || 'Plan changes requested in Diff Review.',
    systemMessage: 'Plan changes requested in Diff Review.'
  };
}

/**
 * Codex PreToolUse 的阻断协议不同于 Stop：退回评论时必须 deny 当前工具调用。
 */
export function formatCodexPreToolUseOutput(result: PlanReviewResult, threads: ReviewThread[]): CodexPreToolUseOutput {
  if (result.decision === 'approved') {
    return {
      systemMessage: 'Plan approved in Diff Review.'
    };
  }

  const feedback = formatPlanChangesRequestedFeedback(result, threads);
  return {
    systemMessage: 'Plan changes requested in Diff Review.',
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: feedback || 'Plan changes requested in Diff Review.'
    }
  };
}

/**
 * Qoder 使用可阻断 hook 的 exit code 反馈；这里复用同一份评论格式。
 */
export function formatPlanChangesRequestedFeedback(result: PlanReviewResult, threads: ReviewThread[]): string {
  const threadFeedback = formatPrompt(threads.filter((thread) => thread.status !== 'resolved')).trim();
  return [result.feedback?.trim(), threadFeedback].filter(Boolean).join('\n\n');
}

/**
 * 计划文本优先取 hook payload 中的内联字段；Codex Stop hook 缺少内联文本时再从 transcript 中兜底提取。
 */
async function extractPlanText(input: CodexHookInput): Promise<string> {
  const inlinePlan = findInlinePlanText(input);
  if (inlinePlan) return inlinePlan;

  const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : '';
  if (!transcriptPath) return '';

  const transcript = await readFile(transcriptPath, 'utf8');
  const latestAssistantText = transcript
    .split('\n')
    .map((line) => parseJsonLine(line))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .map((record) => collectAssistantText(record).trim())
    .filter(Boolean)
    .at(-1);

  return latestAssistantText ?? '';
}

function findInlinePlanText(value: unknown): string {
  const candidates: string[] = [];
  collectInlinePlanText(value, candidates);
  return candidates.sort((left, right) => right.length - left.length)[0]?.trim() ?? '';
}

/**
 * Copilot 的 hook payload 层级不固定，因此递归查找 exit_plan_mode 来判断是否需要拦截。
 */
function containsExitPlanMode(value: unknown): boolean {
  if (typeof value === 'string') return value === 'exit_plan_mode';
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsExitPlanMode(item));
  return Object.values(value as Record<string, unknown>).some((child) => containsExitPlanMode(child));
}

function collectInlinePlanText(value: unknown, candidates: string[]) {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectInlinePlanText(item, candidates);
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === 'string' && isPlanTextKey(key) && child.trim()) {
      candidates.push(child);
      continue;
    }
    collectInlinePlanText(child, candidates);
  }
}

function isPlanTextKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === 'plan' ||
    normalized === 'content' ||
    normalized === 'markdown' ||
    normalized === 'message' ||
    normalized === 'last_assistant_message'
  );
}

/**
 * Codex 执行计划前的最终闸门：只在本地工具即将执行，且当前输入或 transcript 看起来包含计划文本时介入。
 */
function isCodexPreToolPlanReviewInput(input: CodexHookInput): boolean {
  if (input.hook_event_name !== 'PreToolUse' || typeof input.tool_name !== 'string' || !input.tool_name) return false;
  return hasPlanReviewMarker(input) || typeof input.transcript_path === 'string';
}

/**
 * Qoder plan 创建通过 create_plan 工具表达；递归查找可兼容不同 payload 层级。
 */
function isQoderCreatePlanInput(input: CodexHookInput): boolean {
  if (input.hook_event_name !== 'PreToolUse') return false;
  return containsStringValue(input, 'create_plan');
}

function hasPlanReviewMarker(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('<proposed_plan>') || value.includes('</proposed_plan>');
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasPlanReviewMarker(item));
  return Object.values(value as Record<string, unknown>).some((child) => hasPlanReviewMarker(child));
}

function containsStringValue(value: unknown, expected: string): boolean {
  if (typeof value === 'string') return value === expected;
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => containsStringValue(item, expected));
  return Object.values(value as Record<string, unknown>).some((child) => containsStringValue(child, expected));
}

/**
 * 将计划 Markdown 包装成“新增文件”的 diff 结构，从而复用现有行级评论、Markdown preview 和评论侧栏。
 */
function createPlanDiffFile(path: string, content: string): DiffFile {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const snapshotHash = createHash('sha256').update(JSON.stringify({ path, content })).digest('hex').slice(0, 16);

  return {
    oldPath: '/dev/null',
    newPath: path,
    path,
    snapshotHash,
    status: 'added',
    additions: lines.length,
    deletions: 0,
    isMarkdown: true,
    hunks: [
      {
        header: `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines: lines.map((line, index) => ({ type: 'add', content: line, newLineNumber: index + 1 }))
      }
    ]
  };
}

function collectAssistantText(value: unknown): string {
  const texts: string[] = [];
  collectAssistantTextInto(value, false, texts);
  return texts.join('\n');
}

function collectAssistantTextInto(value: unknown, inAssistant: boolean, texts: string[]) {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const role = typeof record.role === 'string' ? record.role : typeof record.type === 'string' ? record.type : '';
  const nextInAssistant = inAssistant || role === 'assistant';

  for (const [key, child] of Object.entries(record)) {
    if (typeof child === 'string' && nextInAssistant && isContentKey(key)) {
      texts.push(child);
      continue;
    }
    if (Array.isArray(child)) {
      for (const item of child) collectAssistantTextInto(item, nextInAssistant, texts);
      continue;
    }
    collectAssistantTextInto(child, nextInAssistant, texts);
  }
}

function isContentKey(key: string): boolean {
  return key === 'content' || key === 'text' || key === 'message';
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStream(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      text += chunk;
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(text));
  });
}
