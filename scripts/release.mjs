import { execSync } from 'node:child_process';

function run(command) {
  console.log(`\n$ ${command}`);
  execSync(command, { stdio: 'inherit' });
}

run('npm run release:check');
run('npm publish');

console.log('\nnpm publish succeeded, pushing commits and tags to GitHub...');
run('git push');
run('git push --tags');

console.log('\nRelease finished: npm published and GitHub updated.');
