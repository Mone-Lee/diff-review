/**
 * Skill 更新回归测试：验证 npm 发布模式保持标准命令，本地链接模式移除自更新并改用全局命令。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSkillSource } from './skill-update';

const npmCommand = 'npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest';
const source = `# Diff Review

Before any other action for each Diff Review task, run this update once from the target workspace:

\`\`\`bash
${npmCommand} update-skill
\`\`\`

If the command reports updated, reload it.

Do not ask the user to run a shell CLI manually.

\`\`\`bash
${npmCommand} [args...]
\`\`\`

Use \`@latest\` and the explicit npmjs registry so npm does not reuse an older npx cache or resolve through a workspace/user \`.npmrc\` mirror.
`;

test('npm 模式保持发布版 Skill 内容不变', () => {
  assert.equal(renderSkillSource(source), source);
});

test('本地模式跳过 npm 自更新并通过链接命令启动', () => {
  const rendered = renderSkillSource(source, 'local-diff-reviewer');
  assert.doesNotMatch(rendered, /Before any other action/);
  assert.doesNotMatch(rendered, /@latest/);
  assert.doesNotMatch(rendered, /npx --yes/);
  assert.match(rendered, /local-diff-reviewer \[args\.\.\.\]/);
  assert.match(rendered, /do not invoke it through `npx`/);
  assert.match(rendered, /Do not ask the user/);
});
