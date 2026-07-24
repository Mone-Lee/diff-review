<!--
Plan mode hook 说明：集中记录 Diff Review 如何接入 Codex/Copilot 的计划审查生命周期，以及 UI 决策如何返回给 agent。
-->

# Plan Mode Hooks

Diff Review 可以作为 agent plan mode 的人工审查关卡：agent 产出计划后，本地 hook 打开一个 Markdown 审查页面；用户在页面上通过计划，或带着评论退回计划；hook 再把结果返回给触发它的 agent turn。

## 支持范围

- Codex：使用 `Stop` hook，命令为 `local-diff-reviewer plan-hook`。
- Copilot：使用 `preToolUse` hook，命令为 `local-diff-reviewer copilot-plan`，只处理 `exit_plan_mode`。
- 审查内容：计划文本会被转换成虚拟 Markdown 文件，复用 Diff Review 的 Markdown preview、行级/选区评论和评论侧栏。
- 返回方式：不查找 agent id，也不向外部服务发送消息；hook 子进程阻塞等待 UI 决策，然后把 JSON 结果写回 stdout。

## 安装 Codex Hook

推荐使用幂等安装命令：

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest install-hooks
```

也可以使用 shell installer：

```bash
curl -fsSL https://raw.githubusercontent.com/Mone-Lee/diff-review/master/scripts/install-hooks.sh | bash
```

默认安装到 `$CODEX_HOME`，未设置时使用 `~/.codex`：

- `config.toml`：确保 `[features] hooks = true`
- `hooks.json`：合并 Codex `Stop` hook

如果只想为当前项目安装：

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest install-hooks --project
curl -fsSL https://raw.githubusercontent.com/Mone-Lee/diff-review/master/scripts/install-hooks.sh | bash -s -- --project
```

项目级安装会写入当前工作区的 `.codex/config.toml` 和 `.codex/hooks.json`。Codex 只会在该项目配置层被 trust 后加载项目级 hooks。

安装后还需要在 Codex 中执行 `/hooks`，review 并 trust 新增或变化的 hook。Codex 会按 hook 内容 hash 记录信任状态；hook 变更后需要重新 trust。

## Codex Hook 配置

`install-hooks` 会合并等价于下面的 `hooks.json` 配置：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest plan-hook",
            "timeout": 600,
            "statusMessage": "Reviewing plan"
          }
        ]
      }
    ]
  }
}
```

Codex 当前 `Stop` hook 不支持 matcher，因此所有 turn 停止时都会触发命令。`plan-hook` 会读取 hook stdin，只有同时满足以下条件才打开审查页面：

- `hook_event_name === "Stop"`
- `permission_mode === "plan"`

其他情况会直接输出：

```json
{"continue":true,"suppressOutput":true}
```

## Copilot Hook 配置

Copilot 可使用独立 `hooks.json`：

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": "npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest copilot-plan",
        "powershell": "npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest copilot-plan",
        "timeoutSec": 600,
        "comment": "Intercepts exit_plan_mode to open local plan review UI"
      }
    ]
  }
}
```

`copilot-plan` 会检查 hook 输入中是否包含 `exit_plan_mode`，只在该工具调用上继续处理。计划文本会从输入里的 `plan`、`content`、`markdown` 或 `message` 字段中提取。

## 响应流程

1. Agent 进入 plan mode 并产出计划。
2. Codex 在 turn 停止时调用 `local-diff-reviewer plan-hook`；Copilot 在调用 `exit_plan_mode` 前调用 `local-diff-reviewer copilot-plan`。
3. Hook 命令从 stdin 读取 hook 输入。
4. 命令提取计划文本：
   - Codex：优先读取输入中的内联字段；否则从 `transcript_path` 中尽力提取最新 assistant 文本。
   - Copilot：从 hook 输入的计划字段提取。
5. 命令创建一个虚拟 Markdown 文件，例如 `.diff-review-plan/<session>-<turn>.md`。
6. 命令启动本地 Diff Review 服务并打开浏览器。
7. Hook 子进程不退出，持续轮询本地服务的 `/api/plan-review-result`。
8. 用户在 UI 中审查计划：
   - 点击“通过计划”：允许 agent 继续。
   - 添加评论后点击“退回评论”：把未解决评论返回给 agent。
9. 前端 POST 到 `/api/plan-review-result`。
10. 阻塞中的 hook 子进程读到结果，向 stdout 输出 hook JSON。
11. Codex/Copilot 读取 hook stdout，并把结果应用到当前 agent turn。

这个绑定依赖的是“触发 hook 的同一个子进程仍在等待”。因此不需要查找具体 agent、session socket 或外部消息通道。

## UI 决策如何返回

通过计划时，hook 输出类似：

```json
{
  "continue": true,
  "systemMessage": "Plan approved in Diff Review."
}
```

退回评论时，hook 会读取当前计划虚拟文件上的未解决评论，用 Diff Review 的 prompt 格式生成反馈，并输出类似：

```json
{
  "continue": false,
  "stopReason": "[thread:<id>]\n.diff-review-plan/<session>-<turn>.md:12\n这里需要补充回滚方案。",
  "systemMessage": "Plan changes requested in Diff Review."
}
```

Codex 的 `Stop` hook 支持 `continue: false` 和 `stopReason`。这会把当前 hook run 标记为 stopped，并把 `stopReason` 作为需要 agent 处理的反馈暴露回当前 loop。

## 评论范围

退回评论只返回当前计划虚拟文件快照上的未解决评论：

- 不混入同一仓库以前的普通 diff 评论。
- 不混入旧计划快照上的历史评论。
- 已 resolved 的评论不会返回给 agent。

## 失败和安全边界

- 如果不是 plan turn，hook 直接放行。
- 如果无法提取计划文本，hook 直接放行。
- 如果已有 `hooks.json` 是损坏 JSON，`install-hooks` 会报错，不会静默覆盖。
- `install-hooks` 只追加缺失的 Diff Review hook，不删除或重写其他 hook。
- 用户仍需在 `/hooks` 中 trust hook；这是 Codex 的安全边界。

## 与 Skill 安装的关系

`npx skills add Mone-Lee/diff-review` 安装的是 skill 指令和脚本，不保证执行任意安装副作用。因此 hook 安装通过以下方式完成：

- 用户手动执行 `local-diff-reviewer install-hooks` 或 shell installer。
- Agent 在帮助安装/配置该 skill 时，按 `SKILL.md` 指令主动执行 `install-hooks`。

如果未来希望做到“安装即自动加载 hook”的原生体验，更适合把 Diff Review 打包成 Codex plugin，并在 plugin manifest 中声明 bundled hooks。
