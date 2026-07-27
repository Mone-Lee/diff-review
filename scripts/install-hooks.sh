#!/usr/bin/env bash
# Installs plan-mode hooks for local-diff-reviewer without requiring users to edit hook config by hand.
set -euo pipefail

PACKAGE="${LOCAL_DIFF_REVIEWER_PACKAGE:-local-diff-reviewer@latest}"

usage() {
  cat <<'USAGE'
Usage: install-hooks.sh [--project] [--qoder] [--help]

Options:
  --project   Install project-local hook config for the current workspace.
  --qoder     Install the Qoder create_plan hook instead of Codex hooks.
  --help      Show this help.

Environment:
  LOCAL_DIFF_REVIEWER_PACKAGE  Override npm package spec. Defaults to local-diff-reviewer@latest.
USAGE
}

args=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)
      args+=("--project")
      shift
      ;;
    --qoder)
      args+=("--qoder")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ "${#args[@]}" -eq 0 ]; then
  npx --yes --registry=https://registry.npmjs.org/ "$PACKAGE" install-hooks
else
  npx --yes --registry=https://registry.npmjs.org/ "$PACKAGE" install-hooks "${args[@]}"
fi
