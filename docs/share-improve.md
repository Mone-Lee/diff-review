当前方案适合**小型 Markdown 文档的异步审阅**，无后端存储、部署简单。但若定位为“分享 diff”，目前能力还不完整：分享的是单文件当前正文和部分评论，没有旧版内容、变更标记或多文件上下文。

建议保留现有静态分享架构，优先完善反馈可靠性，再优化性能。

**优先解决的问题**

1. **P1：刷新会丢失审阅者的评论。**  
   评论只更新 React state，localStorage 仅保存昵称和身份；地址栏也没有同步新评论。误刷新、关闭页面后，已添加的反馈无法恢复。建议按 `shareId + contentHash + reviewerId` 保存草稿，并显示“已保存／尚未导出”状态。见 [ShareApp.tsx:54](/Users/lee/Documents/project/diff-review/src/share/ShareApp.tsx:54)。

2. **P1：修改已回传评论后，再次导入不会更新。**  
   门户允许编辑自己的评论，但导入仅按原始 ID 去重。我实际复现了：首次导入成功，修改正文后再次导入返回 `skipped: 1`，本地仍是旧正文。建议明确采用“追加反馈”，或增加评论版本、更新与冲突处理。见 [share-import.ts:29](/Users/lee/Documents/project/diff-review/src/core/share-import.ts:29)。

3. **P1：容量限制可能让用户写完评论却无法回传。**  
   反馈链接重新打包全文及所有评论，与初始链接共用 32 KiB 上限。接近上限的文档，新增评论后便可能无法导出。建议：
   - 分享前展示实际大小和剩余容量。
   - 将反馈包改为“快照标识 + 评论增量”。
   - 提供文件导出／导入兜底。  
   
   此外，编码端未限制解压后的总大小。我构造的合法载荷生成了 **4,525 字符**链接，但打开时因超过 2 MiB 解压限制失败。编码和解码必须使用一致的限制。见 [share.ts:66](/Users/lee/Documents/project/diff-review/src/shared/share.ts:66)。

4. **P1：文档内部链接会破坏分享地址。**  
   Markdown 中的 `#标题` 链接直接使用原生跳转，会覆盖承载数据的 `#share=…`；随后刷新就无法恢复快照。建议拦截页内锚点，直接滚动定位并保留分享 Fragment。相对文档链接也应明确提示或正确解析。见 [MarkdownPreviewPanel/index.tsx:459](/Users/lee/Documents/project/diff-review/src/web/components/MarkdownPreviewPanel/index.tsx:459)。

**易用性与内容完整性**

- **“当前评论一并打包”的描述不准确。** `diff-line` 和 `markdown-selection` 评论会被过滤，线程解决状态也未保留，门户统一显示为 `submit`。应支持这些信息，或在分享前明确列出遗漏项。见 [share.ts:44](/Users/lee/Documents/project/diff-review/src/shared/share.ts:44)。
- **评论侧栏无法定位正文。** `locateThread` 是空实现，点击位置没有效果；建议接通已有定位能力。见 [ShareApp.tsx:130](/Users/lee/Documents/project/diff-review/src/share/ShareApp.tsx:130)。
- **反馈复制缺少兜底。** 剪贴板失败后仅报错，没有可手动复制的链接框。建议采用本地分享弹窗已有的方式，并提供下载。见 [ShareApp.tsx:103](/Users/lee/Documents/project/diff-review/src/share/ShareApp.tsx:103)。
- **首次阅读被昵称弹窗阻挡。** 可以先允许阅读，在第一次发表评论时要求署名。本地图片目前只显示占位提示，也应在分享前告知发起者。

**性能优化**

| 项目 | 当前证据 | 建议 |
|---|---|---|
| 首屏资源 | 构建入口 JS 为 **1,085 kB，gzip 344 kB** | 分析依赖占比，按需加载评论编辑等次要界面；Mermaid 已动态加载，应保留 |
| 文档重复处理 | 每次 ShareApp 渲染都重新执行 `buildMarkdownBlocks`，包括昵称、整体评论输入 | 按正文缓存 preview，并稳定 `file`、context 等引用，减少正文重复渲染 |
| 反馈导入 | 每条评论都遍历本地所有线程与评论查重 | 预建来源 ID 的 `Set` 和锚点 `Map`，避免批量导入接近平方级扫描 |

相关位置：[ShareApp.tsx:121](/Users/lee/Documents/project/diff-review/src/share/ShareApp.tsx:121)、[share-import.ts:25](/Users/lee/Documents/project/diff-review/src/core/share-import.ts:25)。目前没有浏览器性能录制，因此这些是明确的开销来源，尚不能量化实际卡顿程度。

另一个已复现的可靠性问题：损坏的压缩数据虽然被外层捕获，内部写流仍产生额外的 `unhandledRejection`，需要统一清理和处理读写两端异常。见 [share.ts:192](/Users/lee/Documents/project/diff-review/src/shared/share.ts:192)。

建议实施顺序：**草稿恢复 → 反馈更新与容量闭环 → 链接和评论完整性 → 渲染及包体优化**。若要进一步支持真正的 diff 分享，再扩展版本、文件列表、前后内容与 diff 锚点协议。

本次未修改源码；分享相关 8 项测试、类型检查和分享构建均通过，上述边界问题通过额外脚本或代码路径检查确认。