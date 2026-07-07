# diff-review

![Diff 审查台界面截图](https://raw.githubusercontent.com/Mone-Lee/diff-review/master/docs/images/diff-review-ui.jpg)

AI chat 里的本地代码审查工具。可以直接用 CLI 打开，也可以安装成 agent skill。

## Quick Start

Try it first:

```bash
npx --yes local-diff-reviewer
```

Install and use:

```bash
npm install -g local-diff-reviewer
local-diff-reviewer
```

Enable use from AI agents:

```bash
npx skills add Mone-Lee/diff-review
```

## 功能边界

- 查看当前工作区 diff、staged diff、指定 revision diff。
- 代码文件使用 GitHub 风格 unified diff。
- 图片文件支持 diff 查看。
- Markdown 文件支持 `Preview / Code diff` 切换；`Code diff` 当前只支持 side-by-side，不支持 inline。
- 支持文件级评论、代码行级评论、Markdown source line 评论。
- Markdown 评论在两种视图间会按视图能力降级展示：
  - `Preview` 中的新评论按块级锚定；`Code diff` 中可精确到行。
  - 从 `Code diff` 当前文本一侧创建的评论，会归并展示到对应的 Markdown 块；同一块内的多条评论目前会集中显示在块级内容底部。
  - 对于只存在于旧版本一侧的评论，`Preview` 无法精确展示；定位这类评论时会切换到 `Code diff`。
- 支持 submit / replied / resolved 评论状态。
- 一条 thread 下可以包含多条 comment；同一锚点的新评论会追加到已有 thread。
- 支持通过内部 `--comment` 参数预置 agent findings / replies。
- 支持复制极简 AI prompt。

## CLI 使用方式

```bash
local-diff-reviewer
local-diff-reviewer staged
local-diff-reviewer HEAD~1 HEAD
local-diff-reviewer --new-session
local-diff-reviewer stop
local-diff-reviewer --repo /path/to/project
```

这三种模式分别表示：

- `working`：审查当前工作区里尚未 `git add` 的改动。
- `staged`：审查已经 `git add`、但还没有提交的改动。
- `revision`：审查两个 revision 之间的差异，例如 `local-diff-reviewer HEAD~1 HEAD` 会比较 `HEAD~1..HEAD`。

停止当前项目已启动的 review 进程：

- `stop`：按当前 Git 仓库范围强制关闭该仓库启动过的 review 运行进程（包含其 API 端口进程）；会先尝试优雅退出，超时后自动升级为强制终止。
- `stop` 是按仓库生效，不是全局关闭所有 review 页面；如果本次 review 实际使用的端口在 stop 后仍可访问，往往表示该端口已经被别的仓库复用，或当前仓库仍有页面未停干净。
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

同一项目里再次执行 `local-diff-reviewer` 或 `/diff-review` 时，默认会复用仍在运行的 review 页面和端口，并将该页面刷新为最新 diff。使用 `--new-session` 可以保留已有快照，再打开一个独立页面。不同项目的页面始终分别绑定各自的项目，不会被最后一次启动覆盖。首次启动默认优先使用 `127.0.0.1:4966`；独立页面或其他项目遇到端口占用时会自动选择空闲端口。

```text
项目 A /diff-review -> http://127.0.0.1:4966  -> 项目 A diff
项目 A /diff-review -> http://127.0.0.1:4966  -> 刷新为项目 A 最新 diff
项目 A /diff-review --new-session -> http://127.0.0.1:<空闲端口> -> 项目 A 独立快照
项目 B /diff-review -> http://127.0.0.1:<空闲端口> -> 项目 B diff
```

页面打开后，代码 diff 与 Markdown 的 `Preview / Code diff` 视图都会固定为当前审查快照；工作区继续变动不会自行改写页面内容。再次执行 `local-diff-reviewer` 或 `/diff-review` 会让默认页面自动同步到新快照；使用 `--new-session` 打开的独立页面继续保留旧快照。评论线程与其创建时的 diff 快照绑定：旧线程会在评论侧栏中保留并标记为历史快照，但不会因另一份快照中恰好有相同行号而贴到错误代码上。

评论、快照、代码行之间的绑定关系及页面更新判断详见
[`docs/comment-snapshot-binding.md`](docs/comment-snapshot-binding.md)。

本地开发的 `--dev` 模式会同时为 API 服务和 Vite dev server 选择可用端口，并把 Vite proxy 绑定到本次启动的 API 地址。其他项目已经占用 `4966` 或 `5173` 时，当前项目会自动换用空闲端口。

## Skill 使用方式

在 AI chat 中使用：

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

skill 会以目标 workspace 作为命令工作目录运行 `npx --yes local-diff-reviewer [args...]`，因此 `/diff-review` 会审查当前项目，而不是 skill 安装目录。用户要求停止、关闭或结束当前项目的 Diff Review 时，skill 应直接执行 `/diff-review stop`，而不是只提示这条命令。
如果 `/diff-review stop` 后本次 review 实际使用的端口仍可访问，说明该端口上的页面很可能属于其他仓库，或当前 workspace 的 review 还没有停干净。

### 预置 agent 评论

CLI 支持重复传入 `--comment <json>`，用于在打开 UI 前把 agent 审查结果写入评论存储。

代码 diff 行评论：

```bash
npx --yes local-diff-reviewer \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":36},"body":"这里没有处理空数组，可能导致运行时报错。"}'
```

Markdown source line 评论：

```bash
npx --yes local-diff-reviewer \
  --comment '{"type":"thread","filePath":"README.md","position":{"type":"markdown","line":22},"body":"这里可以补充 old/new side 的例子。"}'
```

文件级评论：

```bash
npx --yes local-diff-reviewer \
  --comment '{"type":"thread","filePath":"src/foo.ts","body":"这个文件的错误处理策略需要统一。"}'
```

回复已有 thread：

```bash
npx --yes local-diff-reviewer \
  --comment '{"type":"reply","threadId":"<thread-id>","body":"同意，这里应该按 repoRoot 隔离评论存储。"}'
```

`thread` 评论会以 `author: "agent"` 写入：如果同一锚点已经存在 thread，会作为新的 comment 追加进去；否则创建 replied thread。`reply` 会向目标 thread 追加一条 agent 回复并把状态切到 replied。为避免 agent finding 反复注入导致刷屏，同一 thread 内相同正文的 agent comment 会被视为重复并跳过。若路径不在当前 diff 中、行号无法定位或内容重复，脚本会跳过并在终端打印 warning。

当 agent 收到从 UI 复制出的 `[thread:<id>]` prompt 并完成处理后，应使用 `type: "reply"` 把处理结果写回原 thread，作为 `author: "agent"` 的 comment 保留在评论流里。回复内容默认保持结论式、尽量短：

- 已按评论完成修改时，优先使用 `已处理`。
- 需要补充一点点定位信息时，可使用 `已处理：xxx`。
- 未修改时，再简短说明原因，例如 `未处理：当前实现已覆盖该场景。`

除非用户明确需要更详细的回写说明，否则不要重复整段 diff、实现细节或长篇解释。

从 UI 复制出的 prompt 示例：

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

- `submit`：只有用户提交的评论，还没有 agent finding / reply。
- `replied`：已有 agent 内容，或从 resolved 重新打开。
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

若 npmjs 认证缺失或过期，发布会在 preflight 阶段提前失败，并提示执行：

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

`npm run dev`（等价于 `npm run review:dev`）会启动 API 服务并打开 Vite dev server，前端代码修改会使用 Vite HMR 热更新。`npm run review` 优先使用已构建的 `dist/web`。

仅调试前端时可使用：

```bash
npm run web:dev
```

注意：`web:dev` 只启动 Vite，不会启动 API 服务。

评论数据默认归档在 `~/.local/diff-review/logs`。Windows 下使用类似位置：
`%LOCALAPPDATA%\diff-review\logs`，如果未设置 `LOCALAPPDATA` 则退到
`~/AppData/Local/diff-review/logs`。
