# Review Session 解析

## Session 是什么

项目里的 `session` 指一次 review 启动时生成的审查快照元数据。每执行一次
`local-diff-reviewer` 或 `/diff-review`，CLI 都会读取当时的 Git diff，并创建
一个新的 `ReviewSession`。

类型定义位于 `src/shared/types.ts`：

```ts
export type ReviewSession = {
  id: string;
  repoName: string;
  repoRoot: string;
  mode: ReviewMode;
  diffHash: string;
  createdAt: string;
};
```

字段含义如下：

| 字段 | 含义 |
| --- | --- |
| `id` | 本次审查启动的唯一标识，每次启动随机生成 |
| `repoName` | 仓库目录名，用于界面显示 |
| `repoRoot` | 仓库绝对路径，用于读取文件、归档评论 |
| `mode` | 本次审查范围：`working`、`staged` 或两个 revision 的比较 |
| `diffHash` | 启动时 diff 文本的摘要，用于标识这份 diff 内容 |
| `createdAt` | 本次审查创建时间 |

## Session 如何产生

入口位于 `src/cli/start.ts`：

```ts
const mode = parseReviewMode(reviewArgs);
const repoRoot = await getRepoRoot(repo ?? process.cwd());
const diff = await getDiff(mode, repoRoot);
const diffFiles = parseUnifiedDiff(diff);

const session: ReviewSession = {
  id: crypto.randomUUID(),
  repoName: basename(repoRoot),
  repoRoot,
  mode,
  diffHash: diffHash(diff),
  createdAt: new Date().toISOString()
};
```

整体流程如下：

1. 解析用户希望审查的变更范围。
2. 获取目标 Git 仓库根目录。
3. 在启动瞬间读取 diff。
4. 解析 diff 的文件与行信息。
5. 为这次启动创建 `ReviewSession`。
6. 将 `session` 与 `diffFiles` 交给本地服务保存在当前进程内存中。

因此，session 与 diff 快照是一一对应的：session 描述的是某个启动时刻看到的
diff 内容及其审查范围。

## 服务端如何使用 Session

服务端状态定义位于 `src/server/index.ts`：

```ts
export type ReviewServerState = {
  session: ReviewSession;
  diffFiles: DiffFile[];
  webDist?: string;
};
```

启动服务后，这份状态存在于当前服务进程内存中，并通过接口暴露给前端：

```ts
app.get('/api/session', (_req, res) => {
  res.json(state.session);
});

app.get('/api/diff', (_req, res) => {
  res.json({ files: state.diffFiles });
});
```

- `/api/session` 返回本次审查的元数据。
- `/api/diff` 返回本次 session 对应的 diff。
- 服务进程未重启或未实现刷新前，这份 diff 不会随工作区后续变更而改变。

Markdown 预览同样依赖 session：

```ts
readFileForPreview(file, state.session.mode, state.session.repoRoot)
```

它通过 session 中的审查模式和仓库路径读取当前快照所需展示的 Markdown 内容。

## 前端如何使用 Session

前端在 `src/web/App.tsx` 首次加载页面时获取 session、diff 与评论：

```ts
const [sessionRes, diffRes, threadRes] = await Promise.all([
  fetch('/api/session'),
  fetch('/api/diff'),
  fetch('/api/threads')
]);

setSession(nextSession);
setFiles(diff.files);
setThreads(store.threads);
```

`session` 当前主要用于界面展示：

- 显示仓库名称。
- 显示当前审查范围，例如工作区、暂存区或 revision 范围。
- 判断当前是本地变更审查还是 revision 比较。

页面打开后，前端周期性同步当前 review 状态；当复用工作台加载了新 session 时，
会更新 diff 和当前快照的评论：

```ts
async function refreshReviewState() {
  const res = await fetch('/api/review-state');
  // session 变化时更新 diff；评论始终全量同步，内容区按文件快照过滤展示
}
```

因此，在用户再次启动默认 review 前，页面持续显示原快照；默认 review 被再次触发
后，已有页面会更新到新快照。

## Session 与评论、运行时记录的区别

`session` 不是持久化的评论会话，也不是正在运行的服务记录。

| 概念 | 保存内容 | 生命周期 | 存储位置 |
| --- | --- | --- | --- |
| `ReviewSession` | 当前 diff 的快照元数据 | 当前服务进程存活期间 | 服务内存 |
| `CommentStore` | 评论 thread 与回复 | 跨多次启动长期保留 | 本地 JSON 文件 |
| `RuntimeEntry` | PID、端口、Vite 子进程信息 | 服务运行期间 | runtime JSON 文件 |

### 评论存储

评论存储位于 `src/server/storage.ts`，并且按 `repoRoot` 归档，而不是按
`session.id` 或 `diffHash` 归档：

```ts
const repoHash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
return join(commentLogsDir(), `${repoName}-${repoHash}.comments.json`);
```

因此，同一个仓库的不同 review session 会读取和写入同一份评论记录。

### 运行时记录

运行时记录位于 `src/cli/runtime-registry.ts`。它保存 PID、端口和 Vite 子进程等
信息，供 `stop` 命令终止运行中的服务使用，不负责描述审查内容或保存评论。

## 当前设计的关键特征

`ReviewSession` 中的 `diffHash` 用于标识整份 diff 来源；真正用于行内挂载与同锚点
合并的是 `ReviewThread.fileSnapshotHash`（对应 `DiffFile.snapshotHash`）。默认复用
工作台刷新到新 session 时，前端会重新加载 diff，并按当前文件快照过滤内容区评论。

当前关系可以表示为：

```text
session A -> 固定展示 diff A
session B -> 固定展示 diff B

session A 与 session B -> 共用同一份 repo 评论文件，侧栏保留历史，内容区按 fileSnapshotHash 挂载
```

评论锚点仍由文件路径与行位置信息组成，而 thread 额外记录 `fileSnapshotHash`。
因此，同一仓库的两份快照即使出现相同文件路径和行号，也不会互相展示行评论。

同一仓库再次启动 review 时，默认会把新 session 提交给已运行服务并沿用原端口；
提交前 CLI 会先检查 `/api/capabilities` 的 `reviewRefreshProtocol`，仅在版本一致时复用；
前端轮询到 session 变化后自动替换 diff。显式传入 `--new-session` 时，则保留
当前页面快照并启动新的独立页面。

## 总结

`session` 是一次 review 启动时的 diff 快照标识与元数据集合，负责说明“当前页面
展示的是哪个仓库、哪种审查范围、哪一份 diff”。评论文件仍按仓库归档，但 thread
通过 `fileSnapshotHash` 绑定到文件级快照，并在内容区按该规则挂载。
