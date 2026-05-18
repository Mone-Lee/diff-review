#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const child = spawn('npx', ['--yes', 'local-diff-reviewer', ...args], {
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
