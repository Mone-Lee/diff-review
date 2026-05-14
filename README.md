# diff-review

AI chat 里的本地代码审查工具。产品入口是 skill slash command：`/diff-review`。

## 功能边界

- 查看当前工作区 diff、staged diff、指定 revision diff。
- 代码文件使用 GitHub 风格 unified diff。
- Markdown 文件只展示 Preview，不提供 Diff / Preview 切换。
- 支持文件级评论、代码行级评论、Markdown source line 评论。
- 支持 unresolved / resolved 评论状态。
- 支持复制极简 AI prompt。

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
