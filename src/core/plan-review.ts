/**
 * Plan review 工具：把 Codex/Copilot hook 输入里的计划文本整理为虚拟 Markdown diff，并生成 hook 返回值。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { DiffFile, PlanReviewResult, ReviewSession, ReviewThread } from '../shared/types';
import { formatPrompt } from './prompt';

export type CodexHookInput = {
  cwd?: unknown;
  hook_event_name?: unknown;
  permission_mode?: unknown;
  transcript_path?: unknown;
  session_id?: unknown;
  turn_id?: unknown;
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

export type PlanReviewSnapshotOptions = {
  requireCodexPlanStop?: boolean;
  requireCopilotExitPlan?: boolean;
};

const PLAN_FILE_PREFIX = '.diff-review-plan';

export async function readHookInputFromStdin(): Promise<CodexHookInput> {
  const text = await readStream(process.stdin);
  if (!text.trim()) return {};
  return JSON.parse(text) as CodexHookInput;
}

export async function buildPlanReviewSnapshot(
  input: CodexHookInput,
  fallbackCwd: string,
  options: PlanReviewSnapshotOptions = {}
): Promise<PlanReviewSnapshot | null> {
  const requireCodexPlanStop = options.requireCodexPlanStop ?? true;
  if (requireCodexPlanStop && (input.permission_mode !== 'plan' || input.hook_event_name !== 'Stop')) return null;
  if (options.requireCopilotExitPlan && !containsExitPlanMode(input)) return null;

  const cwd = typeof input.cwd === 'string' && input.cwd.trim() ? resolve(input.cwd) : fallbackCwd;
  const planText = await extractPlanText(input);
  if (!planText) return null;

  const sessionId = typeof input.session_id === 'string' && input.session_id ? input.session_id : crypto.randomUUID();
  const turnId = typeof input.turn_id === 'string' && input.turn_id ? input.turn_id : crypto.randomUUID();
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
  return normalized === 'plan' || normalized === 'content' || normalized === 'markdown' || normalized === 'message';
}

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
