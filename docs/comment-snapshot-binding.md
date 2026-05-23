# 评论、快照与代码行绑定机制

本文描述 review 页面中 `ReviewSession`、`ReviewThread`、代码/Markdown 锚点之间
的绑定关系，以及页面刷新到新 diff 时的更新与回显规则。文档以当前工作区实现为准。

## 目标

这套机制需要同时满足两个要求：

1. 评论不能因为工作区继续修改或重新执行 `/diff-review` 而消失，用户仍能查看
   已提出的问题及 agent 的处理回复。
2. 旧 diff 上的行评论不能直接贴到新 diff 中恰好相同的文件路径和行号上，否则
   会把旧问题错误地展示在新的代码内容旁边。

因此系统采用“侧栏保留历史，内容区只挂当前快照”的规则。

## 核心对象

### ReviewSession：当前展示的 diff 快照

每次启动 review 时，CLI 都读取一次 diff 并生成一个新的 `ReviewSession`：

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

| 字段 | 用途 |
| --- | --- |
| `id` | 标识一次启动或刷新产生的 session；前端用它判断是否切换了展示快照 |
| `repoRoot` | 决定评论存储归属和可复用的运行中页面 |
| `mode` | 决定 diff 来源：working、staged 或 revision |
| `diffHash` | 对启动时 diff 内容生成的摘要；评论与快照绑定的关键键值 |

同一份 diff 在不同启动中可能拥有不同 `session.id`，但其 `diffHash` 相同；
行评论归属依据是 `diffHash`，而不是 `session.id`。

### ReviewThread：一组评论及其快照归属

```ts
export type ReviewThread = {
  id: string;
  filePath: string;
  anchor: CommentAnchor;
  diffHash?: string;
  status: ReviewThreadStatus;
  comments: ReviewComment[];
  createdAt: string;
  updatedAt: string;
};
```

一个 thread 表示某个评论位置上的讨论流。`comments` 中第一条通常是用户发现，
后续可以是 agent 回复或用户追加内容。

`thread.diffHash` 表明该讨论创建时对应的代码快照。旧数据没有该字段时，CLI 在
首次重新打开该仓库时通过 `attachLegacyComments()` 将其补写为当次 session 的
`diffHash`。

### CommentAnchor：快照内部的位置

```ts
export type CommentAnchor =
  | { type: 'file'; filePath: string }
  | { type: 'diff-line'; filePath: string; side: 'old' | 'new'; lineNumber: number }
  | { type: 'markdown-line'; filePath: string; lineNumber: number; blockId?: string };
```

| 锚点类型 | 绑定位置 | 判断字段 |
| --- | --- | --- |
| `file` | 文件整体 | `filePath` |
| `diff-line` | 代码 diff 的 old/new 行 | `filePath + side + lineNumber` |
| `markdown-line` | Markdown 源文件行 | `filePath + lineNumber` |

锚点只在所属 `diffHash` 内有定位意义。相同行号出现在另一个快照时，不视为同一
可行内挂载位置。

## 绑定关系

完整关系如下：

```text
repoRoot
  └── comment store JSON
        ├── thread A ── diffHash A ── anchor(src/web/App.tsx, new, 80)
        └── thread B ── diffHash B ── anchor(src/web/App.tsx, new, 80)

session A ── diffHash A ── diffFiles A
session B ── diffHash B ── diffFiles B
```

即使 `thread A` 与 `thread B` 的锚点文本完全相同，只要 `diffHash` 不同，它们
仍属于不同快照，不会被合并为同一个行内讨论。

## 评论写入规则

### 用户在页面新增评论

`POST /api/threads` 会使用当前 `state.session.diffHash` 写入 thread。

是否追加到已有 thread 的判断条件为：

```ts
thread.diffHash === state.session.diffHash && sameAnchor(thread.anchor, body.anchor)
```

因此，同一当前快照、同一锚点的评论会追加到同一 thread；历史快照上相同位置的
thread 不会被复用。

### Agent 注入新 finding

CLI 的 `--comment '{"type":"thread", ...}'` 与页面新增评论采用相同原则：

```ts
item.diffHash === diffHash && sameAnchor(item.anchor, thread.anchor)
```

新创建的 agent finding 写入本次启动 session 的 `diffHash`。去重同样要求
`diffHash + filePath + anchor + agent comment body` 都一致。

### Agent 回复已有评论

`--comment '{"type":"reply","threadId":"..."}'` 或
`POST /api/threads/:id/comments` 根据 `threadId` 查找线程，不要求线程属于当前
快照。这样刷新到新 diff 后，agent 仍可以把处理结果回复到用户最初提出问题的
历史 thread 上。

### 状态变更和删除

回复、解决、重新打开、删除 thread，以及可编辑状态下的评论编辑/删除，均按
`threadId` 操作全部存量线程，包括历史快照线程。

## 存储与合并规则

评论数据按 `repoRoot` 持久化到一份 JSON 文件，而不是按快照分别保存。这样
重新执行 `/diff-review` 后仍能读到旧评论。

读取存储时，`normalizeStore()` 使用如下键合并同一讨论位置的数据：

```ts
`${thread.diffHash ?? 'legacy'}:${anchorKey(thread.anchor)}`
```

这意味着：

- 同一快照、同一 anchor 的多个旧 thread 会合并为一个讨论流。
- 不同 `diffHash` 的相同 anchor 不会合并。
- 还没有快照归属的旧数据暂以 `legacy` 分组，并在下次启动时补写归属。

## 页面展示判断

### 评论侧栏：展示全部历史线程

`GET /api/review-state` 返回仓库中的全部 thread。`ThreadList` 接收完整列表，
因此刷新至新快照后，旧评论与 agent 回复仍在右侧评论栏可见。

侧栏的历史标记判断为：

```ts
thread.diffHash !== currentDiffHash
```

满足该条件时显示 `历史快照` 标签。侧栏中的历史 thread 仍可复制 prompt、
继续回复和调整状态。

### 内容区：只挂载当前快照线程

前端在 `App.tsx` 中先筛选当前快照 thread：

```ts
const currentThreads = threads.filter(
  (thread) => thread.diffHash === session?.diffHash
);
```

只有 `currentThreads` 会传给：

- `FileHeader`
- `CodeDiffViewer`
- `MarkdownPreviewPanel`

因此行内评论展示必须同时满足：

```text
thread.diffHash === session.diffHash
且
thread.anchor 与当前文件/当前代码行或 Markdown 行匹配
```

旧 thread 会出现在侧栏，但不会直接渲染在新 diff 的某一行下方。

### 文件列表徽标

当前文件列表中的未解决评论数量直接按文件路径从全部 `threads` 统计，因此徽标
包含该文件上的历史未解决 thread。它用于提示“这个文件仍有讨论记录”，并不表示
这些评论都已行内挂载在当前代码快照上。

## 更新机制

### 首次打开页面

页面首次挂载时调用：

```ts
refreshReviewState(true)
```

它请求 `GET /api/review-state`，获得：

```ts
{
  session: ReviewSession;
  files: DiffFile[];
  threads: ReviewThread[];
}
```

由于 `forceSnapshot` 为 `true`，前端写入 session、diff 文件列表及初始选中文件，
同时保存全部评论线程。

### 页面可见期间的同步

前端在页面可见时通过三种方式触发 `refreshReviewState()`：

| 触发方式 | 行为 |
| --- | --- |
| `setInterval(..., 2500)` | 每 2.5 秒同步一次 |
| 浏览器 `focus` | 用户切回页面时同步 |
| `visibilitychange` 变为 visible | 标签页重新可见时同步 |

每次同步都会更新 thread 列表，因此已有页面能看到外部写入的 agent reply 或
评论状态变化。

当前实现使用下列条件判断是否替换内容区快照：

```ts
const snapshotChanged =
  forceSnapshot || session?.id !== nextState.session.id;
```

当 `snapshotChanged` 为真时，前端更新：

- `session`
- `files`
- `selectedPath`，若原选中文件不在新 diff 中则切换到新快照首个文件

无论快照是否切换，`threads` 都会同步为服务端返回的最新完整线程列表。

### 再次执行 `/diff-review`

默认情况下，同仓库再次执行 CLI 时会查找存活的 runtime，然后向已有服务发送：

```http
POST /api/review-state
```

请求携带新生成的 `session` 与 `diffFiles`。服务端更新内存中的当前 session、
diff 文件及 Markdown 预览缓存，但保留按仓库存储的评论数据。

随后打开着的页面在下一次轮询或重新获得焦点时发现 `session.id` 已变化：

1. 内容区切换为新的 diff 快照。
2. 当前快照的 thread 可继续行内显示。
3. 旧快照 thread 留在侧栏，并显示 `历史快照`。

### `--new-session`

传入 `--new-session` 时不会刷新现有 runtime，而是启动一个独立页面。两个页面
各自持有自己的展示快照，但共享同一仓库的评论存储，因此侧栏都能读取历史讨论，
行内展示仍各自受自己的 `session.diffHash` 限制。

## 判断汇总

| 场景 | 判断 | 结果 |
| --- | --- | --- |
| 新增评论是否追加到已有 thread | 当前 `diffHash` 相同且 anchor 相同 | 追加 comment |
| 相同行号的新快照是否沿用旧 thread | `diffHash` 不同 | 不沿用、不行内挂载 |
| 侧栏是否展示旧评论 | 服务端返回全部 thread | 展示并标为历史快照 |
| 内容区是否展示旧评论 | `thread.diffHash === session.diffHash` | 不满足则不展示 |
| agent 是否能回复旧评论 | 根据 `threadId` 查找 | 可以回复 |
| 是否替换页面中的 diff | `forceSnapshot` 或 `session.id` 改变 | 替换文件快照 |
| 是否同步新回复/状态 | 每次 `refreshReviewState()` | 始终同步 threads |

## 相关实现文件

| 文件 | 责任 |
| --- | --- |
| `src/shared/types.ts` | session、thread、anchor 数据结构 |
| `src/shared/thread-utils.ts` | anchor 比较、分组 key 与状态计算 |
| `src/server/storage.ts` | 按仓库存储、legacy 归属补写、同快照合并 |
| `src/core/comment-import.ts` | agent finding/reply 导入及去重 |
| `src/cli/start.ts` | 新快照创建与运行页面刷新 |
| `src/server/index.ts` | review state 与评论 API |
| `src/web/App.tsx` | 全部 thread 与当前快照 thread 的拆分 |
| `src/web/components/ThreadList.tsx` | 历史 thread 的侧栏回显标记 |
