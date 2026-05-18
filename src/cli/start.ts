import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAgentComments } from '../core/comment-import';
import { parseUnifiedDiff } from '../core/diff-parser';
import { diffHash, getDiff, getRepoRoot, parseReviewMode } from '../core/git';
import { startServer } from '../server';
import type { ReviewSession } from '../shared/types';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const builtWebDist = join(packageRoot, 'dist', 'web');

async function main() {
  // CLI 参数只负责确定审查模式，真正的数据都来自当前仓库状态。
  const { dev, reviewArgs, comments } = parseCliOptions(process.argv.slice(2));
  const mode = parseReviewMode(reviewArgs);
  const repoRoot = await getRepoRoot(process.cwd());
  const diff = await getDiff(mode, repoRoot);
  const diffFiles = parseUnifiedDiff(diff);
  const session: ReviewSession = {
    id: crypto.randomUUID(),
    repoRoot,
    mode,
    diffHash: diffHash(diff),
    createdAt: new Date().toISOString()
  };

  const importResult = await importAgentComments(repoRoot, diffFiles, comments);
  const hasBuiltWeb = existsSync(join(builtWebDist, 'index.html'));
  const apiUrl = await startServer({ session, diffFiles, webDist: hasBuiltWeb ? builtWebDist : undefined });
  // 非 --dev 模式下优先复用已构建的静态页面，避免每次都起 Vite。
  const useVite = dev || !hasBuiltWeb;
  const uiUrl = useVite ? 'http://127.0.0.1:5173' : apiUrl;

  if (useVite) {
    startVite();
  }
  openBrowser(uiUrl);

  console.log(`Diff Review is running: ${uiUrl}`);
  console.log(`Mode: ${modeLabel(mode)}`);
  console.log(`Files: ${diffFiles.length}`);
  if (comments.length > 0) {
    console.log(`Agent comments imported: ${importResult.imported}`);
    for (const skipped of importResult.skipped) {
      console.warn(`Skipped ${skipped}`);
    }
  }
}

function parseCliOptions(args: string[]): { dev: boolean; reviewArgs: string[]; comments: string[] } {
  const reviewArgs: string[] = [];
  const comments: string[] = [];
  let dev = false;

  // CLI 自身消费 --dev/--comment，其余参数才交给 parseReviewMode 判断审查范围。
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dev') {
      dev = true;
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

  return { dev, reviewArgs, comments };
}

function modeLabel(mode: ReviewSession['mode']): string {
  if (mode.kind === 'revision') return `${mode.base}..${mode.target}`;
  return mode.kind;
}

function startVite() {
  // 由 review 进程托管 Vite 子进程，便于 Ctrl+C 一并退出。
  const child = spawn('npm', ['run', 'web:dev'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, BROWSER: 'none' }
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
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
