<!--
本文集中记录 diff-review 仓库的本地开发、版本切换、预置 agent 评论与发布维护流程。
-->

# 开发与维护

## 本地开发

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

`npm run dev`（等价于 `npm run review:dev`）会启动 API 服务并打开 Vite 开发服务器，前端代码修改会使用 Vite HMR 热更新。`npm run review` 优先使用已构建的 `dist/web`。

仅调试前端时可使用：

```bash
npm run web:dev
```

注意：`web:dev` 只启动 Vite，不会启动 API 服务。

`--dev` 模式会同时为 API 服务和 Vite 开发服务器选择可用端口，并把 Vite 代理绑定到本次启动的 API 地址。其他项目已经占用 `4966` 或 `5173` 时，当前项目会自动换用空闲端口。

## 本地源码与 npm 包切换

开发本仓库时，可以让本机其他项目继续调用同一个 `local-diff-reviewer` 命令，并在本地构建产物和 npm 发布包之间切换：

```bash
npm run diff-review:use-local
npm run diff-review:use-npm
npm run diff-review:status
```

`diff-review:use-local` 会先构建当前仓库，再用 `npm link` 把全局 `local-diff-reviewer` 命令指向本地源码，并把 Codex plan hook 临时改为调用这个全局命令。`diff-review:use-npm` 默认切回 `local-diff-reviewer@latest`，同时把 hook 改回 `npx ... @latest`，也可以指定版本：

```bash
npm run diff-review:use-npm -- 4.1.4
```

## 同步 Skill

修改根目录的 `SKILL.md` 后，可用一条命令同步到当前电脑的 Agent Skill 目录：

```bash
npm run skill:update
```

该命令把根目录 `SKILL.md` 作为唯一来源，更新 `~/.agents/skills/diff-review/SKILL.md`，并清理旧版遗留的嵌套 `skill/diff-review` 副本。需要安装到其他位置时，可通过 `DIFF_REVIEW_SKILL_DIR` 指定目标目录。

发布后的 Skill 会在每次调用开始时执行以下命令检查 npm 包中的最新版；检测到变化后，agent 会重新读取本机 Skill 再继续当前任务：

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest update-skill
```

skill 会以目标工作区作为命令工作目录运行 `npx --yes local-diff-reviewer@latest [args...]`，因此 `/diff-review` 会审查当前项目，而不是 skill 安装目录，并尽量避免 npm 复用旧的 npx 缓存。用户要求停止、关闭或结束当前项目的 Diff Review 时，skill 应直接执行 `/diff-review stop`，而不是只提示这条命令。
如果 `/diff-review stop` 后本次审查实际使用的端口仍可访问，说明该端口上的页面很可能属于其他仓库，或当前工作区的审查还没有停干净。

## 预置 agent 评论

命令行支持重复传入 `--comment <json>`，用于在打开界面前把 agent 审查结果写入评论存储。

代码 diff 行评论：

```bash
npx --yes local-diff-reviewer@latest \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":36},"body":"这里没有处理空数组，可能导致运行时报错。"}'
```

Markdown 源码行评论：

```bash
npx --yes local-diff-reviewer@latest \
  --comment '{"type":"thread","filePath":"README.md","position":{"type":"markdown","line":22},"body":"这里可以补充旧/新两侧的例子。"}'
```

文件级评论：

```bash
npx --yes local-diff-reviewer@latest \
  --comment '{"type":"thread","filePath":"src/foo.ts","body":"这个文件的错误处理策略需要统一。"}'
```

回复已有评论线程：

```bash
npx --yes local-diff-reviewer@latest \
  --comment '{"type":"reply","threadId":"<thread-id>","body":"同意，这里应该按 repoRoot 隔离评论存储。"}'
```

`thread` 评论会以 `author: "agent"` 写入：如果同一锚点已经存在评论线程，会作为新的评论追加进去；否则创建 `replied` 状态的评论线程。`reply` 会向目标评论线程追加一条 agent 回复并把状态切到 `replied`。为避免 agent 发现反复注入导致刷屏，同一评论线程内相同正文的 agent 评论会被视为重复并跳过。若路径不在当前 diff 中、行号无法定位或内容重复，脚本会跳过并在终端打印警告。

### 回写约定

当 agent 收到从界面复制出的 `[thread:<id>]` prompt 后，应在本轮结束前使用 `type: "reply"` 把每条评论的处理结果写回原线程，作为 `author: "agent"` 的评论保留在评论流里，并逐条确认写入成功。不要等下次打开审查页面再回写；未处理或部分处理的评论也应说明实际结果，写入失败时应报告对应线程和原因。回写成功后，未解决线程进入 `replied`，是否标记 `resolved` 仍由用户决定。回复内容默认保持结论式、尽量短：

- 完全按评论完成修改时，默认只回复 `已处理`，不复述原要求或已执行的动作。例如要求删除某行代码，回复 `已处理` 即可，不写 `已处理。已删除代码`。
- 仅在用户要求说明，或存在原评论未包含且必须告知的处理偏差、限制、待决事项时，补充必要信息。
- 部分处理或未处理时，简短说明剩余问题或原因，例如 `部分处理：仍需确认兼容范围`、`未处理：缺少必要配置`。

除非用户明确需要更详细的回写说明，否则不要重复整段 diff、实现细节或长篇解释。

回写要求由 diff-review Skill 提供，复制内容只包含线程标识、定位信息和评论，不附加操作提醒；调用方需要加载该 Skill 才能获得上述回写指引。

## 发布流程

```bash
npm run release
npm run release minor
npm run release major
```

该命令会按顺序执行：

- 发布前检查 npmjs 认证与连通性（`npm whoami --registry=https://registry.npmjs.org/` + `npm ping --registry=https://registry.npmjs.org/`）
- `npm run release:check`
- `npm version <patch|minor|major>`（默认 `patch`）
- `npm publish`
- `git push`
- `git push --tags`

若 npmjs 认证缺失或过期，发布会在预检查阶段提前失败，并提示执行：

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

只有在 `npm publish` 成功后，才会自动推送提交和标签到 GitHub。

### CI 标签校验说明

仓库的 GitHub Actions 标签检查任务（`.github/workflows/release-check.yml`）会在推送语义化标签（如 `v2.0.4`）时执行校验（安装依赖、`skill:check`、`release:check`、标签版本一致性检查），但不会执行 `npm publish`。

当前发布策略是手动发布：由本地 `npm run release` 完成 `npm publish` 与 Git 推送。
