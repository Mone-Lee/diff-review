# diff-review

AI chat 里的本地代码审查工具。产品入口是 skill slash command：`/diff-review`。

## 功能边界

- 查看当前工作区 diff、staged diff、指定 revision diff。
- 代码文件使用 GitHub 风格 unified diff。
- Markdown 文件只展示 Preview，不提供 Diff / Preview 切换。
- 支持文件级评论、代码行级评论、Markdown source line 评论。
- 支持 unresolved / resolved 评论状态。
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

复制出的 prompt 只包含：

```text
文件路径:行号
评论内容
```

文件级评论不包含行号：

```text
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
