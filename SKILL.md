---
name: diff-review
description: Use when the user types /diff-review or asks to review the current workspace diff in a local GitHub-style viewer with comments, Markdown preview comments, and minimal AI prompt copying.
metadata:
  short-description: Open a local diff review viewer
---

# Diff Review

Use this skill when the user asks for `/diff-review`, wants to inspect current workspace changes, staged changes, or a revision pair in a local review UI.

## Commands

- `/diff-review`: review current working tree diff.
- `/diff-review working`: review current working tree diff.
- `/diff-review staged`: review staged diff.
- `/diff-review <base> <target>`: review diff between two Git revisions.
- `/diff-review --new-session`: preserve the current snapshot and open a separate review session.
- `/diff-review stop`: stop all review runtimes created for the current workspace repository.

Do not ask the user to run a shell CLI manually. Determine the target workspace/repository from the user's active environment context, then run the package command with that repository as the command working directory:

```bash
npx --yes local-diff-reviewer [args...]
```

Set the shell/tool `cwd` to `/absolute/path/to/target/workspace` before running the command. Do not pass `--repo` from this skill; older published CLI versions treat unknown args as revision args. Do not use the skill package directory or this skill's install directory as the review target unless that is the workspace the user asked to review.

When you have concrete review findings or answers to existing review comments, preload them with one `--comment` JSON argument per comment before launching the viewer:

```bash
npx --yes local-diff-reviewer [args...] \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":36},"body":"Explain the finding in the user language."}' \
  --comment '{"type":"reply","threadId":"existing-thread-id","body":"Answer the existing thread as the agent."}'
```

After a newly started script prints a local URL, open it in the Codex browser when available. If the script reports `Diff Review refreshed`, do not open another page: the already open review page updates automatically. If browser automation is not available, report the URL.

When the user gives you copied prompt text containing `[thread:<id>]`, treat it as an existing review thread. After you answer or make code/doc changes for that thread, append a concise agent reply to the same thread with `--comment '{"type":"reply","threadId":"<id>","body":"..."}'` the next time you launch or refresh the viewer. If the viewer is already running and you can reach the API, post the same reply to `/api/threads/<id>/comments` with `author: "agent"`. Do this for every handled thread unless the user explicitly asks you not to write back. Prefer conclusion-first, minimal replies such as `已处理`, `已处理：xxx`, or `未处理：原因...`; do not repeat the full diff or long implementation details unless the user explicitly wants that detail.

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
