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

### DiffFile：文件级快照标识

每个 diff 文件都携带 `snapshotHash`，表示该文件在当前 diff 中的内容快照：

```ts
export type DiffFile = {
  oldPath: string;
  newPath: string;
  path: string;
  snapshotHash: string;
  // ...
};
```

后续线程挂载、导入合并与历史判断都优先使用这个文件级标识，而不是只看整份 diff 的 `diffHash`。

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
  fileSnapshotHash?: string;
  status: ReviewThreadStatus;
  comments: ReviewComment[];
  createdAt: string;
  updatedAt: string;
};
```

一个 thread 表示某个评论位置上的讨论流。`comments` 中第一条通常是用户发现，
后续可以是 agent 回复或用户追加内容。

`thread.diffHash` 主要用于追溯来源与兼容旧数据；实际用于文件挂载与同锚点合并的
主键是 `thread.fileSnapshotHash`。旧数据没有该字段时，CLI 会在启动时通过
`attachLegacyComments()` 尝试补写。

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

锚点只在所属 `fileSnapshotHash` 内有定位意义。相同行号出现在另一个文件快照时，
不视为同一可行内挂载位置。

## Markdown 评论块定位

Markdown 预览不是逐行渲染，而是先按“可评论块”定位，再把评论入口、行内线程和滚动
目标都挂到这个块上。当前实现里，`markdown-line` 锚点虽然仍然以“源文件行号”存储，
但展示时遵循“同一块统一挂到块起始行”的规则。

### 块划分规则

服务端会先对 Markdown 原文做一层轻量级 block 划分，生成 `preview.blocks`：

- 标题：单行块，`startLine === endLine`
- 引用：连续 `>` 行合并为一个 `blockquote` 块
- 代码块：从 ```` ``` ```` 开始到结束围栏合并为一个 `code` 块
- 列表：连续列表项和其间空行合并为一个 `list` 块
- 表格：表头、分隔行和后续表格行合并为一个 `table` 块
- 普通段落：默认收敛到下一个空行前

每个块都记录：

```ts
type MarkdownBlock = {
  id: string;
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'table' | 'blockquote' | 'other';
  startLine: number;
  endLine: number;
  text: string;
};
```

这里的 `id` 主要用于预览稳定性与块级描述；当前评论匹配和写入仍以
`lineNumber` 为主，`blockId` 只是顺手写成 `line-${lineNumber}`，还没有参与
线程归并判断。

### 写入规则：评论创建在块起始行

Markdown 预览中的每个可评论块最终都会包一层 `MarkdownCommentBlock`。用户点击
评论入口时，前端创建的锚点是：

```ts
{ type: 'markdown-line', filePath, lineNumber, blockId: `line-${lineNumber}` }
```

这里的 `lineNumber` 是当前评论块绑定的行号。对标题、段落、引用、Mermaid、表格等
块来说，都会优先取该 React/HAST 节点的起始源行，因此新评论天然绑定到“块起始行”。

这带来两个直接结果：

- 同一个多行引用块、代码块或表格，不会在块内每一行都生成独立评论入口。
- 评论的逻辑归属是“这整个 Markdown 块”，而不是块内某个视觉子节点。

### 展示规则：块内历史评论折算到 `startLine`

为了兼容旧数据或块内其他行号导入的评论，`MarkdownPreviewPanel` 在渲染前会先做一次
折算：

```ts
const block = preview?.blocks.find(
  (item) =>
    thread.anchor.lineNumber >= item.startLine &&
    thread.anchor.lineNumber <= item.endLine
);
const displayLineNumber = block?.startLine ?? thread.anchor.lineNumber;
```

也就是说，只要某个 `markdown-line` thread 的行号落在某个块的
`[startLine, endLine]` 范围内，前端就会把它挂到该块的 `startLine` 上展示。

因此：

- 历史上挂在引用块第 2 行的评论，当前会显示在这个引用块的第一行入口处。
- Mermaid 或普通 fenced code block 内部任意一行的评论，都会折算到代码块首行。
- 如果某条评论没有命中任何 block，才会回退到它自己的 `thread.anchor.lineNumber`。

### 特殊块的去重与布局规则

Markdown 里有几类块如果按 DOM 子节点继续加评论入口，会出现重复入口或视觉错位，
所以当前实现做了专门约束：

- `blockquote`：外层引用块已经可评论时，内部段落与列表节点不再额外包评论入口。
- `list`：同一个 list block 内，缩进后的嵌套列表会复用外层列表入口，不再各自生成独立入口。
- `heading`：标题自身的 `margin-top` 会被清零，顶部留白转移到评论容器，避免 icon
  对齐到标题外边距顶部而不是文字顶部。
- `table`、`mermaid`：额外垂直间距挂在评论容器上，不靠 `absolute top` 微调入口位置。

这套规则的目标是让“评论锚点”和“布局锚点”保持同一层，减少块级 margin 塌陷、
嵌套段落重复包裹和多入口重叠带来的定位漂移。

### 滚动定位规则

当页面需要自动滚动到某条 Markdown 评论时，也不是直接滚到
`thread.anchor.lineNumber`，而是先查它所属的 block：

```ts
getMarkdownScrollLine(preview, thread.anchor.lineNumber)
```

该函数会返回：

- 若命中某个 block，则返回这个 block 的 `startLine`
- 否则返回下一块的 `startLine`
- 再不行才回退到原始行号

随后前端通过 `data-review-line="<startLine>"` 找到对应的 `MarkdownCommentBlock`。
这样无论评论原始行号位于块内哪一行，滚动、入口和行内线程都会稳定落到同一个块级容器。

## 绑定关系

完整关系如下：

```text
repoRoot
  └── comment store JSON
  ├── thread A ── fileSnapshotHash A ── anchor(src/web/App.tsx, new, 80)
  └── thread B ── fileSnapshotHash B ── anchor(src/web/App.tsx, new, 80)

session A ── diffHash A ── diffFiles A(含每个文件的 snapshotHash)
session B ── diffHash B ── diffFiles B(含每个文件的 snapshotHash)
```

即使 `thread A` 与 `thread B` 的锚点文本完全相同，只要 `fileSnapshotHash` 不同，它们
仍属于不同快照，不会被合并为同一个行内讨论。

## 评论写入规则

### 用户在页面新增评论

`POST /api/threads` 会先定位当前 `filePath` 对应的 `DiffFile.snapshotHash`，并写入
`thread.fileSnapshotHash`。

是否追加到已有 thread 的判断条件为：

```ts
thread.fileSnapshotHash === file.snapshotHash && sameAnchor(thread.anchor, body.anchor)
```

因此，同一当前快照、同一锚点的评论会追加到同一 thread；历史快照上相同位置的
thread 不会被复用。

### Agent 注入新 finding

CLI 的 `--comment '{"type":"thread", ...}'` 与页面新增评论采用相同原则：

```ts
item.fileSnapshotHash === file.snapshotHash && sameAnchor(item.anchor, thread.anchor)
```

新创建的 agent finding 会记录当前文件的 `snapshotHash`。去重同样要求
`fileSnapshotHash + filePath + anchor + agent comment body` 都一致。

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
`${thread.fileSnapshotHash ?? (thread.diffHash ? `diff:${thread.diffHash}` : 'legacy')}:${anchorKey(thread.anchor)}`
```

这意味着：

- 同一文件快照、同一 anchor 的多个旧 thread 会合并为一个讨论流。
- 不同 `fileSnapshotHash` 的相同 anchor 不会合并。
- 还没有快照归属的旧数据暂以 `legacy` 分组，并在下次启动时补写归属。

## 页面展示判断

### 评论侧栏：展示全部历史线程

`GET /api/review-state` 返回仓库中的全部 thread。`ThreadList` 接收完整列表，
因此刷新至新快照后，旧评论与 agent 回复仍在右侧评论栏可见。

侧栏的历史标记判断为：

```ts
!currentFiles.some((file) => isThreadOnFileSnapshot(thread, file))
```

满足该条件时显示 `历史快照` 标签。侧栏中的历史 thread 仍可复制 prompt、
继续回复和调整状态。

### 内容区：只挂载当前快照线程

前端在 `App.tsx` 中先筛选“属于当前 diff 文件集合”的 thread：

```ts
const currentSnapshotThreads = threads.filter(
  (thread) => files.some((file) => isThreadOnFileSnapshot(thread, file))
);
```

随后内容区只接收当前选中文件对应的线程：

```ts
const selectedFileThreads = currentSnapshotThreads.filter(
  (thread) => isThreadOnFileSnapshot(thread, selectedFile)
);
```

只有 `selectedFileThreads` 会传给：

- `FileHeader`
- `CodeDiffViewer`
- `MarkdownPreviewPanel`

因此行内评论展示必须同时满足：

```text
thread.fileSnapshotHash === selectedFile.snapshotHash
且
thread.anchor 与当前文件/当前代码行或 Markdown 行匹配
```

旧 thread 会出现在侧栏，但不会直接渲染在新 diff 的某一行下方。

### 文件列表徽标

当前文件列表中的未解决评论数量按“当前文件快照”统计，不再包含历史快照线程。

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

CLI 在刷新前会先请求 `GET /api/capabilities`，仅当返回的
`reviewRefreshProtocol` 与本地常量一致时才会复用运行中页面。当前协议版本为 `3`，
用于阻止旧页面继续执行旧绑定规则。

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
| 新增评论是否追加到已有 thread | 当前 `fileSnapshotHash` 相同且 anchor 相同 | 追加 comment |
| 相同行号的新快照是否沿用旧 thread | `fileSnapshotHash` 不同 | 不沿用、不行内挂载 |
| 侧栏是否展示旧评论 | 服务端返回全部 thread | 展示并标为历史快照 |
| 内容区是否展示旧评论 | `thread.fileSnapshotHash === selectedFile.snapshotHash` | 不满足则不展示 |
| agent 是否能回复旧评论 | 根据 `threadId` 查找 | 可以回复 |
| 是否替换页面中的 diff | `forceSnapshot` 或 `session.id` 改变 | 替换文件快照 |
| 是否同步新回复/状态 | 每次 `refreshReviewState()` | 始终同步 threads |
| 是否复用运行中页面刷新 | `reviewRefreshProtocol` 一致 | 一致才复用 |

## Prompt 作用域筛选

`POST /api/prompt` 的筛选规则与页面展示规则保持一致：

- `thread`：按 `threadId` 精确选择（不限制是否历史快照）。
- `file-unresolved`：要求 `filePath` 命中、未解决，且属于当前文件快照。
- `all-unresolved`：要求未解决，且属于当前 diff 的文件快照集合。

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
