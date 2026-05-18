import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function run(command) {
  console.log(`\n$ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

function hasStagedOrWorkingChanges() {
  try {
    execSync('git diff --quiet && git diff --cached --quiet', { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function commitReleaseChangesIfNeeded() {
  if (!hasStagedOrWorkingChanges()) {
    console.log('\nNo local changes to commit before release.');
    return;
  }

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const message = `update version ${pkg.version}`;

  run('git add -A');
  run(`git commit -m "${message}"`);
}

run('npm run release:check');
commitReleaseChangesIfNeeded();
run('npm publish');

console.log('\nnpm publish succeeded, pushing commits and tags to GitHub...');
run('git push');
run('git push --tags');

console.log('\nRelease finished: npm published and GitHub updated.');
