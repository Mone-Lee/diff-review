#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const commandArgs = ['--yes', 'local-diff-reviewer', ...args];

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
