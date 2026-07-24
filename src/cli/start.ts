/**
 * CLI 入口：负责解析命令行参数、采集当前仓库 diff、复用或启动 review 服务，并协调浏览器打开流程。
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAgentComments } from '../core/comment-import';
import { parseUnifiedDiff } from '../core/diff-parser';
import { diffHash, getDiff, getRepoRoot, parseReviewMode } from '../core/git';
import { buildPlanReviewSnapshot, formatPlanHookOutput, readHookInputFromStdin } from '../core/plan-review';
import { installCodexPlanHook } from './hooks-installer';
import { getLiveRuntimes, hasRuntimeRecord, recordRuntime, stopRecordedRuntimes, type RuntimeEntry } from './runtime-registry';
import { startServer } from '../server';
import { attachLegacyComments, readComments } from '../server/storage';
import { REVIEW_REFRESH_PROTOCOL, type DiffFile, type PlanReviewResult, type ReviewSession } from '../shared/types';
import { isThreadOnFileSnapshot } from '../shared/thread-utils';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const builtWebDist = join(packageRoot, 'dist', 'web');
const defaultApiPort = 4966;
const packageVersion = readPackageVersion();

async function main() {
  // CLI 参数只负责确定审查模式，真正的数据都来自当前仓库状态。
  const { command, dev, newSession, repo, reviewArgs, comments } = parseCliOptions(process.argv.slice(2));
  if (command === 'help') {
    printHelp();
    return;
  }
  if (command === 'version') {
    console.log(packageVersion);
    return;
  }
  if (command === 'install-hooks') {
    await installHooksCommand(reviewArgs);
    return;
  }
  if (command === 'plan-hook' || command === 'copilot-plan') {
    await planHookCommand(dev, command === 'copilot-plan' ? 'copilot' : 'codex');
    return;
  }
  if (command === 'stop') {
    await stopCommand(repo);
    return;
  }
  const repoRoot = await getRepoRoot(repo ?? process.cwd());
  const mode = resolveInitialReviewMode(reviewArgs);
  logStartup(repoRoot, mode);
  const diff = await getDiff(mode, repoRoot);
  const diffFiles = parseUnifiedDiff(diff);
  const session: ReviewSession = {
    id: crypto.randomUUID(),
    repoName: basename(repoRoot),
    repoRoot,
    mode,
    diffHash: diffHash(diff),
    createdAt: new Date().toISOString()
  };

  await attachLegacyComments(repoRoot, session.diffHash, diffFiles);
  const importResult = await importAgentComments(repoRoot, session.diffHash, diffFiles, comments);
  if (!newSession && !dev) {
    const reusedUrl = await refreshRunningReview(session, diffFiles);
    if (reusedUrl) {
      console.log(`Diff Review refreshed: ${reusedUrl}`);
      console.log(`Repo: ${session.repoName} (${repoRoot})`);
      console.log(`Mode: ${modeLabel(mode)}`);
      console.log(`Files: ${diffFiles.length}`);
      console.log('The existing review page will update automatically.');
      logImportResult(comments, importResult);
      return;
    }
  }

  const hasBuiltWeb = existsSync(join(builtWebDist, 'index.html'));
  const defaultPortSession = await inspectReviewSessionAtPort(defaultApiPort);
  logDefaultPortOccupancy(repoRoot, defaultPortSession);
  const apiUrl = await startServer({ session, diffFiles, webDist: hasBuiltWeb ? builtWebDist : undefined });
  // 非 --dev 模式下优先复用已构建的静态页面，避免每次都起 Vite。
  const useVite = dev || !hasBuiltWeb;
  const vitePort = useVite ? await findAvailablePort(5173) : undefined;
  const uiUrl = useVite ? `http://127.0.0.1:${vitePort}` : apiUrl;

  const vitePid = useVite && vitePort ? startVite(apiUrl, vitePort) : undefined;
  await recordRuntime({
    pid: process.pid,
    vitePid,
    vitePort,
    repoRoot,
    repoName: session.repoName,
    startedAt: session.createdAt,
    apiPort: parsePort(apiUrl),
    usesVite: useVite
  });
  openBrowser(uiUrl);

  console.log(`Diff Review is running: ${uiUrl}`);
  console.log(`Repo: ${session.repoName} (${repoRoot})`);
  if (!useVite && uiUrl !== `http://127.0.0.1:${defaultApiPort}`) {
    logDefaultPortFallback(uiUrl, defaultPortSession);
  }
  console.log(`Mode: ${modeLabel(mode)}`);
  console.log(`Files: ${diffFiles.length}`);
  logImportResult(comments, importResult);
}

function parseCliOptions(args: string[]): {
  command: 'review' | 'stop' | 'install-hooks' | 'plan-hook' | 'copilot-plan' | 'help' | 'version';
  dev: boolean;
  newSession: boolean;
  repo: string | undefined;
  reviewArgs: string[];
  comments: string[];
} {
  let command: 'review' | 'stop' | 'install-hooks' | 'plan-hook' | 'copilot-plan' | 'help' | 'version' = 'review';
  const reviewArgs: string[] = [];
  const comments: string[] = [];
  let repo: string | undefined;
  let dev = false;
  let newSession = false;

  // CLI 自身消费 --dev/--comment，其余参数才交给 parseReviewMode 判断审查范围。
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dev') {
      dev = true;
      continue;
    }
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      command = 'help';
      continue;
    }
    if (arg === '--version' || arg === '-v' || arg === 'version') {
      command = 'version';
      continue;
    }
    if (arg === '--new-session') {
      newSession = true;
      continue;
    }
    if (arg === 'stop') {
      command = 'stop';
      continue;
    }
    if (arg === 'plan-hook' || arg === 'codex-plan-hook') {
      command = 'plan-hook';
      continue;
    }
    if (arg === 'install-hooks' || arg === 'install-plan-hooks') {
      command = 'install-hooks';
      continue;
    }
    if (arg === 'copilot-plan' || arg === 'copilot-plan-hook') {
      command = 'copilot-plan';
      continue;
    }
    if (arg === '--repo') {
      const value = args[index + 1];
      if (!value) throw new Error('--repo requires a path value');
      repo = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      const value = arg.slice('--repo='.length);
      if (!value) throw new Error('--repo requires a path value');
      repo = resolve(value);
      continue;
    }
    if (arg === '--comment') {
      const comment = args[index + 1];
      if (!comment) throw new Error('--comment requires a JSON value');
      comments.push(comment);
      index += 1;
      continue;
    }
    if (arg.startsWith('--comment=')) {
      const comment = arg.slice('--comment='.length);
      if (!comment) throw new Error('--comment requires a JSON value');
      comments.push(comment);
      continue;
    }
    reviewArgs.push(arg);
  }

  return { command, dev, newSession, repo, reviewArgs, comments };
}

async function refreshRunningReview(session: ReviewSession, diffFiles: DiffFile[]): Promise<string | undefined> {
  const runtimes = await getLiveRuntimes(session.repoRoot);
  for (const runtime of runtimes) {
    const apiUrl = `http://127.0.0.1:${runtime.apiPort}`;
    try {
      // 仅复用声明了同版本刷新协议的运行中服务，避免把新快照推给旧实现导致评论丢失展示。
      const capabilityResponse = await fetch(`${apiUrl}/api/capabilities`);
      if (!capabilityResponse.ok) continue;
      const capabilities = (await capabilityResponse.json()) as { appVersion?: unknown; reviewRefreshProtocol?: unknown };
      if (capabilities.reviewRefreshProtocol !== REVIEW_REFRESH_PROTOCOL) continue;
      if (capabilities.appVersion !== packageVersion) continue;
      const response = await fetch(`${apiUrl}/api/review-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, diffFiles })
      });
      if (!response.ok) continue;
      return runtime.usesVite ? `http://127.0.0.1:${runtime.vitePort ?? 5173}` : apiUrl;
    } catch {
      // Runtime records may outlive a process that has just exited; fall through to a new server.
    }
  }
  return undefined;
}

function logStartup(repoRoot: string, mode: ReviewSession['mode']) {
  console.log(`Diff Review ${packageVersion} starting...`);
  console.log(`Repo: ${basename(repoRoot)} (${repoRoot})`);
  console.log(`Mode: ${modeLabel(mode)}`);
  console.log('Collecting git diff...');
}

function logDefaultPortOccupancy(
  repoRoot: string,
  session: Pick<ReviewSession, 'repoName' | 'repoRoot'> | undefined
) {
  if (!session || session.repoRoot === repoRoot) return;
  console.warn(`Default port ${defaultApiPort} is serving repo ${session.repoName} (${session.repoRoot}).`);
}

function logDefaultPortFallback(uiUrl: string, session: Pick<ReviewSession, 'repoName' | 'repoRoot'> | undefined) {
  if (session) {
    console.log(`Default port ${defaultApiPort} is busy with repo ${session.repoName}; using ${uiUrl}`);
    return;
  }
  console.log(`Default port ${defaultApiPort} is busy; using ${uiUrl}`);
}

function logImportResult(comments: string[], result: Awaited<ReturnType<typeof importAgentComments>>) {
  if (comments.length === 0) return;
  console.log(`Agent comments imported: ${result.imported}`);
  for (const skipped of result.skipped) {
    console.warn(`Skipped ${skipped}`);
  }
}

function printHelp() {
  console.log(`local-diff-reviewer ${packageVersion}`);
  console.log('');
  console.log('Usage: local-diff-reviewer [working|staged|<base> <target>] [--new-session] [--repo <path>]');
  console.log('       local-diff-reviewer stop [--repo <path>]');
  console.log('       local-diff-reviewer install-hooks [--project]');
  console.log('       local-diff-reviewer plan-hook');
  console.log('       local-diff-reviewer copilot-plan');
  console.log('');
  console.log('Options:');
  console.log('  --new-session      Open a separate review session instead of refreshing an existing one.');
  console.log('  --repo <path>      Review a repository other than the current working directory.');
  console.log('  --comment <json>   Import an agent comment before opening the viewer.');
  console.log('  install-hooks      Install the Codex plan-mode Stop hook into hooks.json.');
  console.log('  --project          With install-hooks, write .codex/hooks.json in the current workspace.');
  console.log('  plan-hook          Run as a Codex Stop hook for plan-mode review.');
  console.log('  copilot-plan       Run as a Copilot plan-mode hook for exit_plan_mode review.');
  console.log('  --version, -v      Print the CLI version.');
  console.log('  --help, -h         Print this help.');
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function stopCommand(repo: string | undefined): Promise<void> {
  const repoRoot = await getRepoRoot(repo ?? process.cwd());
  const hasRecord = await hasRuntimeRecord(repoRoot);
  const activeRuntimes = await getLiveRuntimes(repoRoot);
  const { stopped, forced, stale } = await stopRecordedRuntimes(repoRoot);
  const total = stopped.length + forced.length + stale.length;
  if (total === 0) {
    if (hasRecord) {
      console.log('No running review process found for this repo.');
      await logRuntimePortOccupancy(repoRoot, activeRuntimes);
      return;
    }
    console.log('No review runtime record found for this repo.');
    await logRuntimePortOccupancy(repoRoot, activeRuntimes);
    return;
  }

  console.log(`Stopped review runtimes: ${stopped.length}`);
  for (const entry of stopped) {
    console.log(
      `- pid=${entry.pid} vitePid=${entry.vitePid ?? '-'} apiPort=${entry.apiPort} vitePort=${entry.vitePort ?? '-'} vite=${entry.usesVite ? 'yes' : 'no'} startedAt=${entry.startedAt}`
    );
  }
  if (forced.length > 0) {
    console.log(`Force killed review runtimes: ${forced.length}`);
    for (const entry of forced) {
      console.log(
        `- pid=${entry.pid} vitePid=${entry.vitePid ?? '-'} apiPort=${entry.apiPort} vitePort=${entry.vitePort ?? '-'} vite=${entry.usesVite ? 'yes' : 'no'} startedAt=${entry.startedAt}`
      );
    }
  }
  if (stale.length > 0) {
    console.log(`Skipped stale records: ${stale.length}`);
  }
  await logRuntimePortOccupancy(repoRoot, activeRuntimes);
}

async function installHooksCommand(args: string[]): Promise<void> {
  const project = args.includes('--project');
  const result = await installCodexPlanHook({ project, cwd: process.cwd() });
  console.log(`${result.changed ? 'Installed' : 'Already installed'} Codex plan hook: ${result.path}`);
  console.log('Open /hooks in Codex to review and trust this hook before it can run.');
}

async function planHookCommand(dev: boolean, runtime: 'codex' | 'copilot'): Promise<void> {
  const input = await readHookInputFromStdin();
  const snapshot = await buildPlanReviewSnapshot(input, process.cwd(), {
    requireCodexPlanStop: runtime === 'codex',
    requireCopilotExitPlan: runtime === 'copilot'
  });
  if (!snapshot) {
    console.log(JSON.stringify({ continue: true, suppressOutput: true }));
    return;
  }

  const hasBuiltWeb = existsSync(join(builtWebDist, 'index.html'));
  const apiUrl = await startServer({
    session: snapshot.session,
    diffFiles: snapshot.diffFiles,
    virtualFiles: snapshot.virtualFiles,
    webDist: hasBuiltWeb ? builtWebDist : undefined
  });
  const useVite = dev || !hasBuiltWeb;
  const vitePort = useVite ? await findAvailablePort(5173) : undefined;
  const uiUrl = useVite ? `http://127.0.0.1:${vitePort}` : apiUrl;
  const vitePid = useVite && vitePort ? startVite(apiUrl, vitePort) : undefined;

  await recordRuntime({
    pid: process.pid,
    vitePid,
    vitePort,
    repoRoot: snapshot.session.repoRoot,
    repoName: snapshot.session.repoName,
    startedAt: snapshot.session.createdAt,
    apiPort: parsePort(apiUrl),
    usesVite: useVite
  });
  openBrowser(uiUrl);
  console.error(`Plan Review is running: ${uiUrl}`);

  const result = await waitForPlanReviewResult(apiUrl);
  const comments = await readComments(snapshot.session.repoRoot);
  const currentPlanThreads = comments.threads.filter((thread) => snapshot.diffFiles.some((file) => isThreadOnFileSnapshot(thread, file)));
  const output = formatPlanHookOutput(result, currentPlanThreads);
  console.log(JSON.stringify(output));
  if (typeof vitePid === 'number') {
    process.kill(vitePid, 'SIGTERM');
  }
  process.exit(0);
}

async function waitForPlanReviewResult(apiUrl: string): Promise<NonNullable<Awaited<ReturnType<typeof readPlanReviewResult>>>> {
  while (true) {
    const result = await readPlanReviewResult(apiUrl);
    if (result) return result;
    await sleep(800);
  }
}

async function readPlanReviewResult(apiUrl: string): Promise<PlanReviewResult | null> {
  const response = await fetch(`${apiUrl}/api/plan-review-result`);
  if (!response.ok) throw new Error(`Failed to read plan review result: ${response.status}`);
  const body = (await response.json()) as { result?: unknown };
  if (!body.result || typeof body.result !== 'object') return null;
  const result = body.result as { decision?: unknown; feedback?: unknown; decidedAt?: unknown };
  if (result.decision !== 'approved' && result.decision !== 'changes-requested') return null;
  const decision = result.decision;
  return {
    decision,
    feedback: typeof result.feedback === 'string' ? result.feedback : undefined,
    decidedAt: typeof result.decidedAt === 'string' ? result.decidedAt : new Date().toISOString()
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `stop` 只按当前仓库回收 runtime；如果这次运行过的实际端口仍能访问，
 * 需要明确告诉用户是当前仓库未停干净，还是端口已经被别的仓库复用。
 */
async function logRuntimePortOccupancy(currentRepoRoot: string, runtimes: RuntimeEntry[]): Promise<void> {
  const ports = collectRuntimePorts(runtimes);
  if (ports.length === 0) return;

  for (const port of ports) {
    const session = await inspectReviewSessionAtPort(port);
    if (!session) continue;

    if (session.repoRoot === currentRepoRoot) {
      console.warn(`Note: http://127.0.0.1:${port} is still serving this repo (${session.repoName}).`);
      continue;
    }

    console.warn(`Note: http://127.0.0.1:${port} is still serving repo ${session.repoName} (${session.repoRoot}).`);
  }
}

/**
 * 通过运行中页面的 `/api/session` 判断默认端口上是否仍有 diff-review 服务，
 * 这样 stop 之后即使端口被其他仓库复用，也能给出具体归属提示。
 */
async function inspectReviewSessionAtPort(
  port: number
): Promise<Pick<ReviewSession, 'repoName' | 'repoRoot'> | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/session`);
    if (!response.ok) return undefined;
    const session = (await response.json()) as Partial<ReviewSession>;
    if (typeof session.repoName !== 'string' || typeof session.repoRoot !== 'string') {
      return undefined;
    }
    return {
      repoName: session.repoName,
      repoRoot: session.repoRoot
    };
  } catch {
    return undefined;
  }
}

function collectRuntimePorts(runtimes: RuntimeEntry[]): number[] {
  const ports = new Set<number>();

  for (const runtime of runtimes) {
    if (Number.isInteger(runtime.apiPort) && runtime.apiPort > 0) {
      ports.add(runtime.apiPort);
    }
    if (typeof runtime.vitePort === 'number' && Number.isInteger(runtime.vitePort) && runtime.vitePort > 0) {
      ports.add(runtime.vitePort);
    }
  }

  return [...ports].sort((left, right) => left - right);
}

function parsePort(url: string): number {
  const parsed = new URL(url);
  const port = parsed.port ? Number(parsed.port) : 80;
  return Number.isNaN(port) ? 0 : port;
}

function resolveInitialReviewMode(reviewArgs: string[]): ReviewSession['mode'] {
  if (reviewArgs.filter(Boolean).length > 0) return parseReviewMode(reviewArgs);
  return { kind: 'working' };
}

function modeLabel(mode: ReviewSession['mode']): string {
  if (mode.kind === 'revision') return `${mode.base}..${mode.target}`;
  if (mode.kind === 'working' && mode.base) return `${mode.base}..working tree`;
  return mode.kind;
}

function findAvailablePort(preferredPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();

    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        findAvailablePort(0).then(resolve, reject);
        return;
      }
      reject(error);
    });

    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function startVite(apiUrl: string, port: number): number | undefined {
  // 由 review 进程托管 Vite 子进程，便于 Ctrl+C 一并退出。
  const child = spawn('npm', ['run', 'web:dev'], {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      BROWSER: 'none',
      DIFF_REVIEW_API_URL: apiUrl,
      DIFF_REVIEW_VITE_PORT: String(port)
    }
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  return child.pid;
}

function openBrowser(url: string) {
  // 按平台选择默认打开方式，避免引入额外依赖。
  const child =
    process.platform === 'darwin'
      ? spawn('open', [url], { stdio: 'ignore', detached: true })
      : process.platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', url], {
            stdio: 'ignore',
            detached: true
          })
        : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
  child.unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
