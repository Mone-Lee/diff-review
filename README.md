# diff-review

![Diff 审查台界面截图](https://raw.githubusercontent.com/Mone-Lee/diff-review/master/docs/images/diff-review-ui.jpg)

AI 对话里的本地代码审查工具。可以直接用命令行打开，也可以安装成 agent skill。

## 快速开始

### 直接试用

```bash
npx --yes local-diff-reviewer@latest
```

### 安装 CLI

```bash
npm install -g local-diff-reviewer
local-diff-reviewer
```

### 安装 agent skill

默认只需要安装 skill。安装后即可在 AI 对话中使用 `/diff-review` 打开当前项目的审查台。

```bash
npx skills add Mone-Lee/diff-review
```

### 可选：启用 plan mode hook

`install-hooks` 不是必需步骤。只有希望 agent 在 plan mode 结束时自动打开计划审查台，才需要额外安装 plan mode hook：

```bash
npx --yes local-diff-reviewer@latest install-hooks
```

也可以用 shell 安装器合并 Codex hook 和配置：

```bash
curl -fsSL https://raw.githubusercontent.com/Mone-Lee/diff-review/master/scripts/install-hooks.sh | bash
```

plan mode hook 的完整流程见 [`docs/plan-mode-hooks.md`](docs/plan-mode-hooks.md)。

## 功能边界

- 查看当前工作区 diff、暂存区 diff、指定版本 diff。
- 代码文件使用 GitHub 风格的 unified diff。
- 图片文件支持 diff 查看。
- Markdown 文件支持 `Preview / Code diff` 切换；`Code diff` 当前只支持并排视图，不支持行内视图。
- 支持文件级评论、代码行级评论、Markdown 源码行评论。
- Markdown 评论在两种视图间会按视图能力降级展示：
  - `Preview` 中的新评论按块级锚定；`Code diff` 中可精确到行。
  - 从 `Code diff` 当前文本一侧创建的评论，会归并展示到对应的 Markdown 块；同一块内的多条评论目前会集中显示在块级内容底部。
  - 对于只存在于旧版本一侧的评论，`Preview` 无法精确展示；定位这类评论时会切换到 `Code diff`。
- 支持 `submit` / `replied` / `resolved` 评论状态。
- 一条评论线程下可以包含多条评论；同一锚点的新评论会追加到已有线程。
- 支持通过内部 `--comment` 参数预置 agent 发现和回复。
- 支持复制极简 AI prompt。
- 支持作为 Codex / Copilot / Qoder 的 plan mode hook，在 agent 执行前审查计划并通过评论退回。

## CLI 使用方式

```bash
local-diff-reviewer
local-diff-reviewer staged
local-diff-reviewer HEAD~1 HEAD
local-diff-reviewer --new-session
local-diff-reviewer stop
local-diff-reviewer --repo /path/to/project
```

### 本地源码与 npm 包切换

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

### Plan mode hook

`local-diff-reviewer plan-hook` 可以作为 Codex plan mode 的 `Stop` hook 使用。工具会把本轮计划作为虚拟 Markdown 文件打开到本地审查台。你可以在计划预览上添加评论，然后点击“退回评论”让 agent 继续改计划；也可以点击“通过计划”允许当前 plan turn 结束。受 Codex 当前公开 hook 能力限制，通过后仍需要回到 Codex 点击原生 “Yes, implement this plan” 才会进入实施。

推荐用安装命令幂等创建或合并 Codex `hooks.json`：

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest install-hooks
```

或使用仓库里的 shell 安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/Mone-Lee/diff-review/master/scripts/install-hooks.sh | bash
```

默认写入 `$CODEX_HOME/hooks.json`，未设置 `CODEX_HOME` 时写入 `~/.codex/hooks.json`，并确保同目录 `config.toml` 中 `[features] hooks = true`。安装器会合并 Codex `Stop` hook，并清理本工具旧版 `PreToolUse` 和误用的 `PermissionRequest` hook，避免重复弹窗。如果只想为当前项目安装，使用：

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest install-hooks --project
curl -fsSL https://raw.githubusercontent.com/Mone-Lee/diff-review/master/scripts/install-hooks.sh | bash -s -- --project
```

命令不会覆盖已有 hook，只会追加缺失的 Codex plan hook，并移除本工具历史版本写入的 `codex-pre-tool-plan` 和 `codex-permission-plan`。Codex 仍会要求先在 `/hooks` 中信任新增或变化的 hook。`Stop` hook 当前不支持 matcher，因此命令自身会从 transcript 中识别当前 turn 的 `collaboration_mode_kind === "plan"` 和 Plan item。

手动配置时，Codex 示例 `~/.codex/hooks.json` 或项目 `.codex/hooks.json`：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest plan-hook",
            "timeout": 600,
            "statusMessage": "正在审查计划"
          }
        ]
      }
    ]
  }
}
```

Copilot 示例 `hooks.json`：

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest copilot-plan",
        "powershell": "npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest copilot-plan",
        "timeoutSec": 600,
        "comment": "拦截 exit_plan_mode，并打开本地计划审查界面"
      }
    ]
  }
}
```

`copilot-plan` 会从 hook 输入中读取 `plan` / `content` / `markdown` / `message` 字段里的计划文本，并复用同一套本地审查界面。

Qoder 可显式安装 `create_plan` hook：

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest install-hooks --qoder
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest install-hooks --qoder --project
```

全局安装写入 `~/.qoder/settings.json`；项目级安装写入 `.qoder/settings.local.json`。

这三种模式分别表示：

- `working`：审查当前工作区里尚未 `git add` 的改动。
- `staged`：审查已经 `git add`、但还没有提交的改动。
- `revision`：审查两个版本之间的差异，例如 `local-diff-reviewer HEAD~1 HEAD` 会比较 `HEAD~1..HEAD`。

停止当前项目已启动的审查进程：

- `stop`：按当前 Git 仓库范围强制关闭该仓库启动过的审查运行进程（包含其 API 端口进程）；会先尝试优雅退出，超时后自动升级为强制终止。
- `stop` 是按仓库生效，不是全局关闭所有审查页面；如果本次审查实际使用的端口在 stop 后仍可访问，往往表示该端口已经被别的仓库复用，或当前仓库仍有页面未停干净。
- `stop` 成功时会等待相关 API/Vite 端口真正释放，而不只是等待进程收到退出信号。

```bash
local-diff-reviewer stop
local-diff-reviewer --repo /path/to/project stop
```

如果命令不是在目标项目目录里启动，可以用 `--repo <path>` 显式指定要审查的 Git 仓库：

```bash
local-diff-reviewer --repo /path/to/project
local-diff-reviewer --repo /path/to/project staged
```

同一项目里再次执行 `local-diff-reviewer` 或 `/diff-review` 时，默认会复用仍在运行的审查页面和端口，并将该页面刷新为最新 diff。使用 `--new-session` 可以保留已有快照，再打开一个独立页面。不同项目的页面始终分别绑定各自的项目，不会被最后一次启动覆盖。首次启动默认优先使用 `127.0.0.1:4966`；独立页面或其他项目遇到端口占用时会自动选择空闲端口。

```text
项目 A /diff-review -> http://127.0.0.1:4966  -> 项目 A diff
项目 A /diff-review -> http://127.0.0.1:4966  -> 刷新为项目 A 最新 diff
项目 A /diff-review --new-session -> http://127.0.0.1:<空闲端口> -> 项目 A 独立快照
项目 B /diff-review -> http://127.0.0.1:<空闲端口> -> 项目 B diff
```

页面打开后，代码 diff 与 Markdown 的 `Preview / Code diff` 视图都会固定为当前审查快照；工作区继续变动不会自行改写页面内容。再次执行 `local-diff-reviewer` 或 `/diff-review` 会让默认页面自动同步到新快照；使用 `--new-session` 打开的独立页面继续保留旧快照。评论线程与其创建时的 diff 快照绑定：旧线程会在评论侧栏中保留并标记为历史快照，但不会因另一份快照中恰好有相同行号而贴到错误代码上。

评论、快照、代码行之间的绑定关系及页面更新判断详见
[`docs/comment-snapshot-binding.md`](docs/comment-snapshot-binding.md)。

本地开发的 `--dev` 模式会同时为 API 服务和 Vite 开发服务器选择可用端口，并把 Vite 代理绑定到本次启动的 API 地址。其他项目已经占用 `4966` 或 `5173` 时，当前项目会自动换用空闲端口。

## Skill 使用方式

在 AI 对话中使用：

```text
/diff-review
/diff-review staged
/diff-review HEAD~1 HEAD
/diff-review --new-session
/diff-review stop
```

安装 skill：

```bash
npx skills add Mone-Lee/diff-review
```

skill 会以目标工作区作为命令工作目录运行 `npx --yes local-diff-reviewer@latest [args...]`，因此 `/diff-review` 会审查当前项目，而不是 skill 安装目录，并尽量避免 npm 复用旧的 npx 缓存。用户要求停止、关闭或结束当前项目的 Diff Review 时，skill 应直接执行 `/diff-review stop`，而不是只提示这条命令。
如果 `/diff-review stop` 后本次审查实际使用的端口仍可访问，说明该端口上的页面很可能属于其他仓库，或当前工作区的审查还没有停干净。

### 预置 agent 评论

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

当 agent 收到从界面复制出的 `[thread:<id>]` prompt 并完成处理后，应使用 `type: "reply"` 把处理结果写回原评论线程，作为 `author: "agent"` 的评论保留在评论流里。回复内容默认保持结论式、尽量短：

- 已按评论完成修改时，优先使用 `已处理`。
- 需要补充一点点定位信息时，可使用 `已处理：xxx`。
- 未修改时，再简短说明原因，例如 `未处理：当前实现已覆盖该场景。`

除非用户明确需要更详细的回写说明，否则不要重复整段 diff、实现细节或长篇解释。

从界面复制出的 prompt 示例：

```text
[thread:33fdc4a2-3cfa-419f-9aa4-b1ae4f662241]
test.md:41
markdown评论

[thread:4f053318-5922-45d0-99e2-377071942422]
test.md:new:37
new行内评论

[thread:82546c3b-52b5-42be-9358-c685b2ad1693]
test.md:old:57
old行内评论

[thread:86fca351-f2c7-4d41-810c-f810fe066ca4]
src/core/prompt.ts
文件级评论
```

评论状态含义：

- `submit`：只有用户提交的评论，还没有 agent 发现或回复。
- `replied`：已有 agent 内容，或从 `resolved` 重新打开。
- `resolved`：用户确认完成后的状态。

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

评论数据默认归档在 `~/.local/diff-review/logs`。Windows 下使用类似位置：
`%LOCALAPPDATA%\diff-review\logs`，如果未设置 `LOCALAPPDATA` 则退到
`~/AppData/Local/diff-review/logs`。
