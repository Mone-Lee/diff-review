# Markdown Preview 评论映射修复说明

本文记录一个具体问题的修复原理：Markdown 文件在 `Code diff` 里创建了行级评论，
切回 `Preview` 后看不到对应评论。

文档描述的是当前实现中，这个问题为什么会发生，以及当前 diff 是如何把它修好的。

## 问题现象

以 `README.md:new:36` 这类评论为例：

- 用户在 Markdown 文件的 `Code diff` 中，对当前文本一侧的某一行创建评论。
- 该评论在线程侧栏中可见，在 `Code diff` 中也能正常显示。
- 但切回 `Preview` 后，内容区看不到对应评论。

这不是评论存储丢失，也不是快照过滤失效，而是“评论行号映射到 Preview 块”的链路
中断了。

## 当前设计目标

Markdown 的两种视图粒度不同：

- `Code diff` 能精确到 `old/new` 侧的具体行。
- `Preview` 只能稳定挂到“可评论块”上，例如段落、列表、引用、表格、代码块。

因此当前设计不是把 `Code diff` 评论原样搬到 `Preview`，而是：

1. 将可映射的评论折算到所属 Markdown block。
2. 将该评论展示在 block 对应的评论容器上。

这意味着 `Preview` 中的评论位置本质上是“块级定位”，不是“源码精确行定位”。

## 根因

这个问题实际由两层逻辑共同造成。

### 1. 视图间锚点需要先做映射

`Code diff` 中的评论锚点是：

```ts
{ type: 'diff-line', filePath, side: 'new' | 'old', lineNumber: number }
```

而 `Preview` 只能按 Markdown block 渲染评论，所以前端必须先把这类线程折算成
一个 Preview 中可挂载的行号。

当前实现里，这一步由 [MarkdownPreviewPanel/utils.ts](../src/web/components/MarkdownPreviewPanel/utils.ts)
中的 `getPreviewThreadLine()` 完成：

- 文件级评论：不映射
- `old` 侧评论：不在 `Preview` 中展示
- `new` 侧评论：根据 `lineNumber` 找所属 block，并返回该 block 的 `startLine`

只有完成这一步，`threadsByLine` 才能把 `Code diff` 创建的评论挂到 Preview 块上。

### 2. Markdown block 划分曾经是错的

这次 bug 的真正根因在于 block 划分。

以 `README.md` 里的“功能边界”列表为例，修复前的 `buildMarkdownBlocks()` 会把它错误切成：

- `list`: `30-34`
- `paragraph`: `35-41`

而用户创建的评论在 `36` 行，所以：

1. `getPreviewThreadLine()` 会把它折算到 `35`
2. 但 `35-41` 这一段在 Preview 里并不是一个稳定的列表块评论容器
3. 最终线程虽然存在，却找不到正确挂点，于是表现成“Preview 看不到评论”

也就是说，问题不在评论数据，也不在评论线程过滤，而在“映射后的目标块本身就是错的”。

### 为什么旧代码会把它切成 `list: 30-34` 和 `paragraph: 35-41`

这段错误切分，来自旧实现里的两个简化规则叠加。

#### 旧列表逻辑只认“下一行还是列表项”

修复前，列表块大致按下面这类条件继续收集：

```ts
while (
  index < lines.length &&
  (lines[index].trim() === '' || /^\s*([-*+]|\d+\.)\s+/.test(lines[index]))
) {
  collected.push(lines[index]);
  index += 1;
}
```

也就是说，旧逻辑只把两类行视为“还属于当前列表”：

- 空行
- 继续以 `-` / `*` / `1.` 开头的行

但 `README.md` 里的第 35 行实际上是：

```md
  `Preview` 中的新增评论按块级锚定；`Code diff` 中可精确到 old/new 行。
```

它虽然在 Markdown 语义上属于上一条列表项的缩进续行，但它前面只有缩进，没有新的
`- ` 标记。所以旧逻辑不会把它视为 list 的一部分，导致列表在第 34 行就提前结束，
得到：

- `list: 30-34`

#### 旧段落逻辑只看空行，不会在新块前停下

旧代码里的普通段落是按“直到下一个空行”为止来收敛的，大致相当于：

```ts
while (index < lines.length && lines[index].trim() !== '') {
  collected.push(lines[index]);
  index += 1;
}
```

这个规则的问题是：它不会在遇到新的 Markdown block 起点时停下。

于是从第 35 行开始后：

1. 第 35 行被当成了 paragraph 起点。
2. 第 36、37 行虽然重新以 `- ` 开头，本来应该开一个新的列表块。
3. 但因为段落逻辑只检查“是不是空行”，不会检查“是不是新的列表项”，所以它把
   `35-41` 整段都吞进了同一个 paragraph。

于是最终就变成：

- `list: 30-34`
- `paragraph: 35-41`

#### 这两个问题叠加后的后果

第 36 行评论在视图映射时，会先按 block 划分结果落到 `35-41` 这个 paragraph 上。
但 Preview 渲染时，这一段并不是我们预期的“完整列表块评论容器”，于是评论虽然还在，
却找不到稳定挂点，看起来就像“Preview 消失了”。

## 修复思路

修复不是改评论存储协议，而是把“映射”和“块划分”这两层打通。

### 1. 让 Preview 接受 `Code diff` 当前文本侧评论

在 [MarkdownPreviewPanel/index.tsx](../src/web/components/MarkdownPreviewPanel/index.tsx) 中，
`threadsByLine` 不再只处理 `markdown-line`，而是统一调用 `getPreviewThreadLine(preview, thread)`。

这样：

- `markdown-line` 评论仍按原有块级逻辑展示
- `diff-line:new` 评论也能折算到对应 block 的 `startLine`
- `diff-line:old` 评论仍然不会在 `Preview` 中误挂到当前文本

这一步解决的是“Preview 愿不愿意接这类评论”。

### 2. 修正 `buildMarkdownBlocks()` 的列表识别

在 [markdown-source-map.ts](../src/core/markdown-source-map.ts) 中，列表块识别做了两处修正：

1. 列表会继续吞入缩进续行，而不是只识别显式 `-` / `1.` 开头的行。
2. 普通段落在收敛时，遇到新的 Markdown block 起点会停止，避免把后续列表内容误吞进段落。

为此新增了几组辅助判断：

- `isListLine()`
- `isIndentedContinuationLine()`
- `isListBlockLine()`
- `startsNewMarkdownBlock()`

修复后，`README.md` 这段会被正确识别成一个完整的：

- `list`: `30-42`

于是 `README.md:new:36` 这条评论会被折算到 `30`，并稳定挂到整个列表块上。

这一步解决的是“映射目标是不是一个正确的 Preview 块”。

## 修复后的数据链路

现在这类评论在 `Preview` 中的展示链路如下：

1. 用户在 Markdown `Code diff` 中创建 `diff-line:new` 评论。
2. 评论 thread 以 `diff-line` 锚点写入存储。
3. `MarkdownPreviewPanel` 渲染时，调用 `getPreviewThreadLine()`。
4. `getPreviewThreadLine()` 根据 `lineNumber` 找到所属 Markdown block。
5. 线程被归并到该 block 的 `startLine`。
6. Preview 中对应 block 的 `MarkdownCommentBlock` 接收到该线程并渲染出来。

如果 block 划分正确，这条链路就能闭环。

## 为什么不是挂到具体列表项

当前实现仍然是“块级归并”，不是“列表项级归并”。

这意味着：

- `README.md:new:36` 不会挂到第 36 行那个具体 `li`
- 它会挂到包含该行的整个 `list` block

这是当前方案的有意选择，而不是残留 bug。它用较低复杂度换取更稳定的 Preview 定位。

## 当前行为边界

修复完成后，当前行为边界如下：

- `Code diff` 当前文本一侧创建的评论，可以在 `Preview` 中显示
- `Preview` 中的位置是所属 Markdown block，不是精确源码行
- 旧版本一侧的评论不会在 `Preview` 中误展示
- 多条评论会按 block 聚合显示

当前 UI 中，列表块的评论展示在块级内容底部。这是展示策略问题，不影响评论映射是否成功。

## 涉及文件

- [src/web/components/MarkdownPreviewPanel/index.tsx](../src/web/components/MarkdownPreviewPanel/index.tsx)
- [src/web/components/MarkdownPreviewPanel/utils.ts](../src/web/components/MarkdownPreviewPanel/utils.ts)
- [src/core/markdown-source-map.ts](../src/core/markdown-source-map.ts)
