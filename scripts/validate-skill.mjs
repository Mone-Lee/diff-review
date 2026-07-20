import { readFile } from 'node:fs/promises';

const content = await readFile('SKILL.md', 'utf8');

function fail(message) {
  console.error(`SKILL validation failed: ${message}`);
  process.exit(1);
}

if (!content.startsWith('---\n')) {
  fail('SKILL.md must start with YAML frontmatter.');
}

const end = content.indexOf('\n---\n', 4);
if (end === -1) {
  fail('SKILL.md frontmatter must end with a closing --- line.');
}

const frontmatter = content.slice(4, end);
if (!/^name:\s*\S+/m.test(frontmatter)) {
  fail('frontmatter must include a non-empty name field.');
}
if (!/^description:\s*.+/m.test(frontmatter)) {
  fail('frontmatter must include a non-empty description field.');
}

if (!content.includes('npx --yes local-diff-reviewer@latest')) {
  fail('SKILL.md must reference `npx --yes local-diff-reviewer@latest`.');
}

if (content.includes('npx local-diff-reviewer') || content.includes('npx --yes local-diff-reviewer ')) {
  fail('SKILL.md must use `npx --yes local-diff-reviewer@latest`.');
}

console.log('SKILL.md validation passed.');
