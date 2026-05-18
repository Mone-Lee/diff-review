import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function run(command) {
  console.log(`\n$ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

function readVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

function getReleaseType() {
  const releaseType = process.argv[2] ?? 'patch';
  const allowed = new Set(['patch', 'minor', 'major']);
  if (!allowed.has(releaseType)) {
    console.error(`\nInvalid release type: "${releaseType}"`);
    console.error('Usage: npm run release [patch|minor|major]');
    process.exit(1);
  }
  return releaseType;
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

  const message = 'chore: prepare release';

  run('git add -A');
  run(`git commit -m "${message}"`);
}

const releaseType = getReleaseType();

run('npm run release:check');
commitReleaseChangesIfNeeded();
run(`npm version ${releaseType} --no-git-tag-version`);

const version = readVersion();
run('git add package.json package-lock.json 2>/dev/null || git add package.json');
run(`git commit -m "release: v${version}"`);
run(`git tag v${version}`);
run('npm publish --registry=https://registry.npmjs.org/');

console.log('\nnpm publish succeeded, pushing commits and tags to GitHub...');
run('git push');
run('git push --tags');

console.log('\nRelease finished: npm published and GitHub updated.');
