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

Do not ask the user to run a shell CLI manually. Run the bundled internal script from the workspace root:

```bash
node skill/diff-review/scripts/start-review.mjs [args...]
```

When you have concrete review findings or answers to existing review comments, preload them with one `--comment` JSON argument per comment before launching the viewer:

```bash
node skill/diff-review/scripts/start-review.mjs [args...] \
  --comment '{"type":"thread","filePath":"src/foo.ts","position":{"side":"new","line":36},"body":"Explain the finding in the user language."}' \
  --comment '{"type":"reply","threadId":"existing-thread-id","body":"Answer the existing thread as the agent."}'
```

After the script prints a local URL, open it in the Codex browser when available. If browser automation is not available, report the URL.

## Review Scope

- Code files render as GitHub-style unified diffs.
- Markdown files (`.md`, `.mdx`) render only as preview, not as a Diff / Preview toggle.
- Markdown line comments anchor to source Markdown line numbers.
- Comments support submit/replied/resolved state.
- AI prompt copy output includes `[thread:<id>]`, file path, line number or Markdown source line, and comment body.
- Agent findings can be preloaded as comments with `--comment`.

## Comment Arguments

- Use `type: "thread"` for each new finding.
- Use `type: "reply"` only when replying to an existing `threadId`.
- Write comment bodies in the language the user is using.
- Use `position.side: "new"` for lines that exist on the target side of the diff.
- Use `position.side: "old"` for lines that exist only on the deleted side.
- Omit `position` for file-level comments.
- Use `position: {"type":"markdown","line":N}` for Markdown source line comments.
- Use range comments only by passing `line: {"start":N,"end":M}`; the viewer anchors to the start line.
- Never copy secrets, tokens, passwords, API keys, private keys, or other credential-like material from the diff into `--comment` bodies or any command-line argument.

## Exclusions

Do not implement or offer GitHub PR integration, TUI, cloud sync, automatic AI calls, or a user-facing CLI.
