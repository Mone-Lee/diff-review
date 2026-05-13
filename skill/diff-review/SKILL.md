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

After the script prints a local URL, open it in the Codex browser when available. If browser automation is not available, report the URL.

## Review Scope

- Code files render as GitHub-style unified diffs.
- Markdown files (`.md`, `.mdx`) render only as preview, not as a Diff / Preview toggle.
- Markdown line comments anchor to source Markdown line numbers.
- Comments support unresolved/resolved state.
- AI prompt copy output must contain only file path, line number or Markdown source line, and comment body.

## Exclusions

Do not implement or offer unresolved review thread import, GitHub PR integration, TUI, cloud sync, automatic AI calls, or a user-facing CLI.
