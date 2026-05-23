import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAgentComments } from '../core/comment-import';
import { parseUnifiedDiff } from '../core/diff-parser';
import { diffHash, getDiff, getRepoRoot, parseReviewMode } from '../core/git';
import { getLiveRuntimes, hasRuntimeRecord, recordRuntime, stopRecordedRuntimes } from './runtime-registry';
import { startServer } from '../server';
import { attachLegacyComments } from '../server/storage';
import type { DiffFile, ReviewSession } from '../shared/types';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const builtWebDist = join(packageRoot, 'dist', 'web');

async function main() {
  // CLI 参数只负责确定审查模式，真正的数据都来自当前仓库状态。
  const { command, dev, newSession, repo, reviewArgs, comments } = parseCliOptions(process.argv.slice(2));
  if (command === 'stop') {
    await stopCommand(repo);
    return;
  }
  const mode = parseReviewMode(reviewArgs);
  const repoRoot = await getRepoRoot(repo ?? process.cwd());
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

  await attachLegacyComments(repoRoot, session.diffHash);
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
  const uiUrl = useVite ? 'http://127.0.0.1:5173' : apiUrl;

  const vitePid = useVite ? startVite() : undefined;
  await recordRuntime({
    pid: process.pid,
    vitePid,
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
      const response = await fetch(`${apiUrl}/api/review-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session, diffFiles })
      });
      if (!response.ok) continue;
      return runtime.usesVite ? 'http://127.0.0.1:5173' : apiUrl;
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
  const { stopped, stale } = await stopRecordedRuntimes(repoRoot);
  const total = stopped.length + stale.length;
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
      `- pid=${entry.pid} vitePid=${entry.vitePid ?? '-'} apiPort=${entry.apiPort} vite=${entry.usesVite ? 'yes' : 'no'} startedAt=${entry.startedAt}`
    );
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

function modeLabel(mode: ReviewSession['mode']): string {
  if (mode.kind === 'revision') return `${mode.base}..${mode.target}`;
  return mode.kind;
}

function startVite(): number | undefined {
  // 由 review 进程托管 Vite 子进程，便于 Ctrl+C 一并退出。
  const child = spawn('npm', ['run', 'web:dev'], {
    cwd: packageRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, BROWSER: 'none' }
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
