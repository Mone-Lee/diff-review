---
name: diff-review
description: Use when the user types /diff-review, asks to review the current workspace diff in a local GitHub-style viewer, or provides copied review comments containing [thread:ID] to address and reply to.
metadata:
  short-description: Open a local diff review viewer
---

# Diff Review

Use this skill when the user asks for `/diff-review`, wants to inspect current workspace changes, staged changes, or a revision pair in a local review UI, or provides copied comments containing `[thread:<id>]` for handling and reply write-back.

## Commands

- `/diff-review`: review current working tree diff.
- `/diff-review working`: review current working tree diff.
- `/diff-review staged`: review staged diff.
- `/diff-review <base> <target>`: review diff between two Git revisions.
- `/diff-review --new-session`: preserve the current snapshot and open a separate review session.
- `/diff-review stop`: force close all review runtimes created for the current workspace repository.

Before any other action for each Diff Review task, run this update once from the target workspace:

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest update-skill
```

If the command reports `Diff Review Skill updated`, read `~/.agents/skills/diff-review/SKILL.md` again and follow the refreshed instructions before continuing. Do not run the update again during the same task. If it reports `already current`, continue normally. If the installed npm version does not recognize `update-skill`, continue with the loaded instructions and report that the automatic Skill check requires a newer published version.

Do not ask the user to run a shell CLI manually. Determine the target workspace/repository from the user's active environment context, then run the package command with that repository as the command working directory:

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest [args...]
```

Set the shell/tool `cwd` to `/absolute/path/to/target/workspace` before running the command. Use `@latest` and the explicit npmjs registry so npm does not reuse an older npx cache or resolve through a workspace/user `.npmrc` mirror. Do not pass `--repo` from this skill; older published CLI versions treat unknown args as revision args. Do not use the skill package directory or this skill's install directory as the review target unless that is the workspace the user asked to review.

When you are helping install or set up this skill, also install the Codex plan-mode hook once:

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest install-hooks
```

This command enables `[features] hooks = true` in the same Codex config directory and merges the Codex `Stop` hook into `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json` without removing existing hooks. Tell the user to open `/hooks` and trust the new or changed hook before expecting plan-mode review to run. If the user asks for project-local hook config, run the same command with `--project` from the target workspace.

When the user asks to `stop`, `关闭`, `结束`, or otherwise shut down Diff Review for the current project, execute `/diff-review stop` immediately. Do not only explain the command or leave the existing runtime running.
After `/diff-review stop` completes, verify that the review URL previously in use is no longer reachable. If it is still serving Diff Review, read `/api/session` to identify its `repoRoot`, run `stop` for that repository, and verify the URL again before reporting success.

When you have concrete review findings or answers to existing review comments, preload them with one `--comment` JSON argument per comment before launching the viewer:

```bash
npx --yes --registry=https://registry.npmjs.org/ local-diff-reviewer@latest [args...] \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":36},"body":"Explain the finding in the user language."}' \
  --comment '{"type":"reply","threadId":"existing-thread-id","body":"Answer the existing thread as the agent."}'
```

After a newly started script prints a local URL, open it in the Codex browser when available. If the script reports `Diff Review refreshed`, do not open another page: the already open review page updates automatically. If browser automation is not available, report the URL.

When the user gives you copied prompt text containing `[thread:<id>]` to handle, collect the distinct thread IDs as the reply checklist for this task. Before your final response, write a concise result to each original thread unless the user explicitly asks you not to write back. Do not postpone replies until a later viewer launch. When the request is fully completed as asked, reply with exactly `已处理` by default. Do not append a restatement of the request or the action taken: for a request to delete a line, write `已处理`, not `已处理。已删除代码`. Add detail only when the user requests it or it conveys necessary information the original comment does not contain, such as a deviation, limitation, or decision needed. For partial or unhandled requests, state the remaining issue or reason briefly, for example `部分处理：仍需确认兼容范围` or `未处理：缺少必要配置`. A chat response or a new finding does not replace a reply to the original thread.

Use the package command above with one `--comment '{"type":"reply","threadId":"<id>","body":"..."}'` argument per thread. If the viewer is already running at a known URL, verify `/api/session` identifies the target repository, then POST `{ "author": "agent", "body": "..." }` to `/api/threads/<id>/comments`. Always use the original ID even when edits changed the diff or line numbers; do not substitute a new `type: "thread"` finding.

Confirm write-back for every checklist ID: inspect the API response for the saved agent comment, or check CLI import counts and skipped warnings. A zero exit code alone does not prove every reply was imported. If a request times out or reports a duplicate, inspect the stored thread before retrying; an old reply about earlier work does not prove the current result was saved. Report any remaining failed thread IDs and reasons in your final response rather than claiming write-back succeeded or retrying indefinitely. Successful agent replies move open threads to `replied`; leave `resolved` to the user's explicit decision. Keep replies concise and do not repeat the full diff or long implementation details unless requested.

## Review Scope

- Code files render as GitHub-style unified diffs.
- Markdown files (`.md`, `.mdx`) render only as preview, not as a Diff / Preview toggle.
- Markdown line comments anchor to source Markdown line numbers.
- Comments support submit/replied/resolved state.
- AI prompt copy output includes `[thread:<id>]`, file path, line number or Markdown source line, and comment body.
- Agent findings can be preloaded as comments with `--comment`.
- A thread can contain multiple comments. New findings for the same anchor are appended to the existing thread, and repeated agent comments with identical bodies in the same thread are skipped.
- Comments are associated with the diff snapshot where they were created. Refreshed workbenches retain older threads in the comment rail as history, without attaching old line comments to changed content.

## Comment Arguments

- Use `type: "thread"` for each new finding.
- Use `type: "reply"` only when replying to an existing `threadId`.
- When handling copied `[thread:<id>]` prompt text, use `type: "reply"` for the completion/status response so the answer is preserved as an agent comment in the original thread.
- Write comment bodies in the language the user is using.
- Use `position.side: "new"` for lines that exist on the target side of the diff.
- Use `position.side: "old"` for lines that exist only on the deleted side.
- Omit `position` for file-level comments.
- Use `position: {"type":"markdown","line":N}` for Markdown source line comments.
- Use range comments only by passing `line: {"start":N,"end":M}`; the viewer anchors to the start line.
- Never copy secrets, tokens, passwords, API keys, private keys, or other credential-like material from the diff into `--comment` bodies or any command-line argument.

## Exclusions

Do not implement or offer GitHub PR integration, TUI, cloud sync, automatic AI calls, or a remote hosted review service.
