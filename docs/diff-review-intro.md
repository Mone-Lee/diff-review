# diff-review 介绍文档

`diff-review` 是一个面向 AI Coding Agent 的本地代码审查工具（Diff 审查台）。

一句话介绍：
Agent 把 diff / plan 推进浏览器给你看一眼，你在行号上评评论，agent 读完评论自动改代码，直到你说 OK。

## 为什么做这个？

在 AI 协作开发里，我们反复遇到 3 个问题：

1. Agent 跑完就 apply，人来不及看。
2. 终端跑 diff，文本体验很差。
3. 修改路径分散，难以查看完整脉络。

`diff-review` 的目标，就是把“人审查 + Agent 执行”这条链路做成一个可持续、多轮闭环的本地流程。

## 核心场景

1. `plan` 审查（Markdown 预览）
在 Agent 开始或继续改代码前，先审查计划内容；可按需删除评论，反复迭代计划，确保方向一致。

2. 本地 `diff` 审查（代码变更）
对当前工作区、staged 或 revision diff 进行逐行审查；在具体行号上给出反馈，让 Agent 基于评论继续修改，再进入下一轮 review。

## 关键能力

1. 行级、文件级评论
支持在代码行和文件维度直接评论，便于精准指出问题和建议。

2. 多轮状态流转：`submit -> replied -> resolved`
评论线程支持完整状态变化，清晰表示“已提出 / 已响应 / 已确认完成”。

3. 自动提炼并回显 Agent findings
Agent 的审查发现与回复可自动注入并回显到线程中，减少手工搬运信息。

4. 评论记录自动归档：`~/.local/diff-review/logs`
每次 review 的评论数据都会落盘，方便后续追溯与复盘。

5. 纯本地：`127.0.0.1`，代码不出本机
服务运行在本地地址，审查过程不依赖把代码上传到远端平台。

## Skill 场景使用流程

1. 安装 skill
```bash
npx skills add Mone-Lee/diff-review
```

2. 在 AI chat 中发起审查
```text
/diff-review
/diff-review staged
/diff-review HEAD~1 HEAD
```
分别对应工作区改动、staged 改动、指定 revision 区间改动。

3. 在浏览器审查并评论
打开本地 `diff-review` 页面后，按文件或行号添加评论（文件级 / 行级），形成待处理 thread。

4. Agent 读取 thread 并回写处理结果
Agent 根据评论修改代码，并把处理说明回写到对应 thread；线程状态会从 `submit` 进入 `replied`。

5. 人工确认并收敛
你验证改动后，将已完成 thread 标记为 `resolved`；若仍有问题，可继续评论进入下一轮，直到全部关闭。

## 定位总结

`diff-review` = Browser review + Agent loop + Local first。  
它不是替代 Git diff，而是把人和 Agent 之间最关键的“审查与反馈”流程变得可视、可追踪、可闭环。
