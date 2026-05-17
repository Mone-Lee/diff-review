# diff-review

AI chat 里的本地代码审查工具。产品入口是 skill slash command：`/diff-review`。

## 功能边界

- 查看当前工作区 diff、staged diff、指定 revision diff。
- 代码文件使用 GitHub 风格 unified diff。
- Markdown 文件只展示 Preview，不提供 Diff / Preview 切换。
- 支持文件级评论、代码行级评论、Markdown source line 评论。
- 支持 submit / replied / resolved 评论状态。
- 一条 thread 下可以包含多条 comment；同一锚点的新评论会追加到已有 thread。
- 支持通过内部 `--comment` 参数预置 agent findings / replies。
- 支持复制极简 AI prompt。

## 评论定位原理（新手友好版）

很多人会直觉认为：评论只和“第几行”绑定。  
比如删掉第 10 行后，原来第 11 行顶上来变成第 10 行，评论也应该跟着走。

这个工具不是这样做的。它用的是“锚点”定位，锚点至少包含：

- 文件路径（`filePath`）
- 行号（`lineNumber`）
- 行所在版本（`side`：旧版本 `old` / 新版本 `new`，代码 Diff 专用）

这意味着评论绑定的是“哪一个版本里的哪一行”，而不是“屏幕上现在第几行”。

### 为什么删除内容后评论可能不显示？

- 对代码 Diff 行评论：
  - 如果评论当时加在被删除的旧行上，它的锚点是 `old + 行号`。
  - 删除后右侧展示的是新版本内容（`new`），`old` 锚点找不到对应渲染位置时，就不会显示在行内。
- 对 Markdown 行评论：
  - 评论绑定的是 source line（源文件行号）。
  - 被评论的那段 Markdown 真被删掉后，预览里没有对应块可挂载，行内自然不显示。

### 一个非常短的例子

1. 你在 `old` 版本第 20 行加了评论。  
2. 后续改动把第 20 行删除，并让后面内容上移。  
3. 新内容虽然“占了第 20 行的位置”，但它属于 `new` 版本，不是原来的 `old` 行。  
4. 所以系统不会把旧评论自动贴到新内容上。

这样做的好处是：避免评论“串行”到语义完全不同的内容上，减少误导。

复制出的 prompt 包含 thread id、定位信息和评论内容。thread id 用于让 agent 后续通过 `--comment '{"type":"reply",...}'` 精确回复原评论：

```text
[thread:<thread-id>]
文件路径:行号
评论内容
```

文件级评论不包含行号：

```text
[thread:<thread-id>]
文件路径
评论内容
```

## Skill 使用方式

在 AI chat 中使用：

```text
/diff-review
/diff-review staged
/diff-review HEAD~1 HEAD
```

这三种模式分别表示：

- `working`：审查当前工作区里尚未 `git add` 的改动。
- `staged`：审查已经 `git add`、但还没有提交的改动。
- `revision`：审查两个 revision 之间的差异，例如 `/diff-review HEAD~1 HEAD` 会比较 `HEAD~1..HEAD`。

内部脚本位于：

```bash
node skill/diff-review/scripts/start-review.mjs [args...]
```

这个脚本是 skill 实现细节，不作为用户侧产品入口。

### 预置 agent 评论

内部脚本支持重复传入 `--comment <json>`，用于在打开 UI 前把 agent 审查结果写入评论存储。

代码 diff 行评论：

```bash
node skill/diff-review/scripts/start-review.mjs \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":36},"body":"这里没有处理空数组，可能导致运行时报错。"}'
```

Markdown source line 评论：

```bash
node skill/diff-review/scripts/start-review.mjs \
  --comment '{"type":"thread","filePath":"README.md","position":{"type":"markdown","line":22},"body":"这里可以补充 old/new side 的例子。"}'
```

文件级评论：

```bash
node skill/diff-review/scripts/start-review.mjs \
  --comment '{"type":"thread","filePath":"src/foo.ts","body":"这个文件的错误处理策略需要统一。"}'
```

回复已有 thread：

```bash
node skill/diff-review/scripts/start-review.mjs \
  --comment '{"type":"reply","threadId":"<thread-id>","body":"同意，这里应该按 repoRoot 隔离评论存储。"}'
```

`thread` 评论会以 `author: "agent"` 写入：如果同一锚点已经存在 thread，会作为新的 comment 追加进去；否则创建 replied thread。`reply` 会向目标 thread 追加一条 agent 回复并把状态切到 replied。为避免 agent finding 反复注入导致刷屏，同一 thread 内相同正文的 agent comment 会被视为重复并跳过。若路径不在当前 diff 中、行号无法定位或内容重复，脚本会跳过并在终端打印 warning。

当 agent 收到从 UI 复制出的 `[thread:<id>]` prompt 并完成处理后，应使用 `type: "reply"` 把处理结果写回原 thread，作为 `author: "agent"` 的 comment 保留在评论流里。回复内容应简要说明已修改什么，或说明为什么没有修改。

评论状态含义：

- `submit`：只有用户提交的评论，还没有 agent finding / reply。
- `replied`：已有 agent 内容，或从 resolved 重新打开。
- `resolved`：用户确认完成后的状态。

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
