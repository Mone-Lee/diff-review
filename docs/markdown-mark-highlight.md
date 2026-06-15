# Markdown 预览高亮标签支持说明

Markdown 预览需要引入 `rehype-raw`，是因为 `<mark>` 和 `pre`、`blockquote` 这类元素处在不同的解析阶段。

`pre`、`blockquote` 来自标准 Markdown 语法。Markdown parser 会直接把代码块、引用块解析成结构化 AST 节点，所以 `react-markdown` 的 `components.pre`、`components.blockquote` 可以接到它们并自定义渲染。

`<mark>` 则属于 Markdown 文本里的原始 HTML。默认情况下，`react-markdown` 出于安全考虑不会把 raw HTML 继续解析成真正的 HAST element。也就是说，如果没有 `rehype-raw`，渲染链路里并不存在一个可被 `components.mark` 或 CSS 稳定处理的 `mark` 节点。

当前链路是：

```text
markdown 文本
-> remark 解析 Markdown AST
-> rehype-raw 将 raw HTML 解析成 HAST element
-> rehype-sanitize 过滤不允许的 HTML
-> ReactMarkdown components 渲染
```

所以 `<mark>高亮</mark>` 的支持分成两步：

1. `rehype-raw` 把 raw HTML 里的 `<mark>` 解析成真正的元素节点。
2. `rehype-sanitize` 基于默认安全 schema 额外放行 `mark` 标签，避免打开全部 HTML 能力。

这样可以支持高亮标签，同时继续过滤未放行的 HTML、危险属性和脚本内容。

另外，预览也支持 `==高亮==` 这种轻量 Markdown 扩展语法。实现方式是在 remark 阶段只扫描普通 text 节点，把它转换成等价的 `<mark>高亮</mark>` 片段，再交给同一套 `rehype-raw` 和 `rehype-sanitize` 链路处理。

这种做法的边界是：

- 代码块和行内 code 不会被转换。
- `==...==` 内部按普通文本处理，不额外解析嵌套 Markdown。
- 安全策略和 `<mark>...</mark>` 原始标签保持一致。
