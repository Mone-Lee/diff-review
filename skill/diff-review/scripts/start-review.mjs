#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const hasRepoArg = args.some((arg) => arg === '--repo' || arg.startsWith('--repo='));
const commandArgs = ['--yes', 'local-diff-reviewer'];
if (!hasRepoArg) {
  commandArgs.push('--repo', resolve(process.cwd()));
}
commandArgs.push(...args);

const child = spawn('npx', commandArgs, {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
