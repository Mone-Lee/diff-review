import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

await build({
  entryPoints: ['src/cli/start.ts'],
  outfile: 'dist/cli/start.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  banner: {
    js: '#!/usr/bin/env node'
  }
});

await chmod('dist/cli/start.js', 0o755);
