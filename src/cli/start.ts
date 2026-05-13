import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseUnifiedDiff } from '../core/diff-parser';
import { diffHash, getDiff, getRepoRoot, parseReviewMode } from '../core/git';
import { startServer } from '../server';
import type { ReviewSession } from '../shared/types';

async function main() {
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
  const child = spawn('npm', ['run', 'dev'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, BROWSER: 'none' }
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

function openBrowser(url: string) {
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
