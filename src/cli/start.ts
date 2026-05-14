import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnifiedDiff } from '../core/diff-parser';
import { diffHash, getDiff, getRepoRoot, parseReviewMode } from '../core/git';
import { startServer } from '../server';
import type { ReviewSession } from '../shared/types';

async function main() {
  // CLI 参数只负责确定审查模式，真正的数据都来自当前仓库状态。
  const { dev, reviewArgs } = parseCliOptions(process.argv.slice(2));
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

  const apiUrl = await startServer({ session, diffFiles });
  // 非 --dev 模式下优先复用已构建的静态页面，避免每次都起 Vite。
  const hasBuiltWeb = existsSync(join(process.cwd(), 'dist', 'web', 'index.html'));
  const useVite = dev || !hasBuiltWeb;
  const uiUrl = useVite ? 'http://127.0.0.1:5173' : apiUrl;

  if (useVite) {
    startVite();
  }
  openBrowser(uiUrl);

  console.log(`Diff Review is running: ${uiUrl}`);
  console.log(`Mode: ${modeLabel(mode)}`);
  console.log(`Files: ${diffFiles.length}`);
}

function parseCliOptions(args: string[]): { dev: boolean; reviewArgs: string[] } {
  return {
    dev: args.includes('--dev'),
    reviewArgs: args.filter((arg) => arg !== '--dev')
  };
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
