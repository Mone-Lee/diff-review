/**
 * CLI 入口：负责解析命令行参数、采集当前仓库 diff、复用或启动 review 服务，并协调浏览器打开流程。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAgentComments } from '../core/comment-import';
import { parseUnifiedDiff } from '../core/diff-parser';
import { diffHash, getDefaultWorkingBase, getDiff, getRepoRoot, parseReviewMode } from '../core/git';
import { getLiveRuntimes, hasRuntimeRecord, recordRuntime, stopRecordedRuntimes } from './runtime-registry';
import { startServer } from '../server';
import { attachLegacyComments } from '../server/storage';
import { REVIEW_REFRESH_PROTOCOL, type DiffFile, type ReviewSession } from '../shared/types';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const builtWebDist = join(packageRoot, 'dist', 'web');

async function main() {
  // CLI 参数只负责确定审查模式，真正的数据都来自当前仓库状态。
  const { command, dev, newSession, repo, reviewArgs, comments } = parseCliOptions(process.argv.slice(2));
  if (command === 'stop') {
    await stopCommand(repo);
    return;
  }
  const repoRoot = await getRepoRoot(repo ?? process.cwd());
  const mode = await resolveInitialReviewMode(reviewArgs, repoRoot);
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
  if (!useVite && uiUrl !== 'http://127.0.0.1:4966') {
    console.log(`Default port 4966 is busy; using ${uiUrl}`);
  }
  console.log(`Mode: ${modeLabel(mode)}`);
  console.log(`Files: ${diffFiles.length}`);
  logImportResult(comments, importResult);
}

function parseCliOptions(args: string[]): {
  command: 'review' | 'stop';
  dev: boolean;
  newSession: boolean;
  repo: string | undefined;
  reviewArgs: string[];
  comments: string[];
} {
  let command: 'review' | 'stop' = 'review';
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
    if (arg === '--new-session') {
      newSession = true;
      continue;
    }
    if (arg === 'stop') {
      command = 'stop';
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
      const capabilities = (await capabilityResponse.json()) as { reviewRefreshProtocol?: unknown };
      if (capabilities.reviewRefreshProtocol !== REVIEW_REFRESH_PROTOCOL) continue;
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

function logImportResult(comments: string[], result: Awaited<ReturnType<typeof importAgentComments>>) {
  if (comments.length === 0) return;
  console.log(`Agent comments imported: ${result.imported}`);
  for (const skipped of result.skipped) {
    console.warn(`Skipped ${skipped}`);
  }
}

async function stopCommand(repo: string | undefined): Promise<void> {
  const repoRoot = await getRepoRoot(repo ?? process.cwd());
  const hasRecord = await hasRuntimeRecord(repoRoot);
  const { stopped, forced, stale } = await stopRecordedRuntimes(repoRoot);
  const total = stopped.length + forced.length + stale.length;
  if (total === 0) {
    if (hasRecord) {
      console.log('No running review process found for this repo.');
      return;
    }
    console.log('No review runtime record found for this repo.');
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
}

function parsePort(url: string): number {
  const parsed = new URL(url);
  const port = parsed.port ? Number(parsed.port) : 80;
  return Number.isNaN(port) ? 0 : port;
}

async function resolveInitialReviewMode(reviewArgs: string[], repoRoot: string): Promise<ReviewSession['mode']> {
  if (reviewArgs.filter(Boolean).length > 0) return parseReviewMode(reviewArgs);
  const base = await getDefaultWorkingBase(repoRoot);
  return base ? { kind: 'working', base } : { kind: 'working' };
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
