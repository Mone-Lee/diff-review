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

if (!frontmatter.includes('Read this SKILL.md in a standalone tool call and wait for its result')) {
  fail('frontmatter description must require reading the Skill before constructing a review command.');
}

if (!content.includes('npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest')) {
  fail('SKILL.md must reference `npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest`.');
}

if (content.includes('npx local-diff-reviewer') || content.includes('npx --yes local-diff-reviewer ')) {
  fail('SKILL.md must use `npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest`.');
}

if (!content.includes('do not silently omit `DIFF_REVIEW_SKILL_FILES`') || !content.includes('Use an interactive choice control when available')) {
  fail('SKILL.md must offer an explicit scope choice when an attached file path cannot be resolved.');
}

if (!content.includes('Never combine reading this file and launching the reviewer in one shell command or one tool call')) {
  fail('SKILL.md must prohibit combining Skill reads with reviewer startup.');
}

if (!content.includes('`# Files mentioned by the user:` section as explicit selections')) {
  fail('SKILL.md must recognize Codex file-capsule paths as explicit selections.');
}

console.log('SKILL.md validation passed.');
