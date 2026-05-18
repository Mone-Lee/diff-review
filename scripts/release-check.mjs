import { execSync } from 'node:child_process';

function run(command) {
  console.log(`\\n$ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

run('node scripts/validate-skill.mjs');
run('npm run typecheck');
run('npm run build');
run('npm pack --dry-run');

console.log('\\nRelease checks passed.');
