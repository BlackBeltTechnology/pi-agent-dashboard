#!/usr/bin/env bash
#
# effective-status.sh — wrapper around `openspec status --change <name> --json`
# that applies the dashboard's local-design-evidence override so OpenSpec
# workflow skills and dashboard buttons cannot disagree about a change's
# next-ready artifact.
#
# Output: the same JSON shape as `openspec status --change <name> --json`,
# possibly with `artifacts[design].status` promoted from "ready" to "done"
# and `isComplete` re-derived. All other fields pass through unchanged.
#
# Rules (must mirror packages/shared/src/openspec-design-evidence.ts —
# enforced by packages/shared/src/__tests__/openspec-design-evidence.test.ts
# and the wrapper-vs-ts-parity test):
#
#   R1  any file matching ^design.*\.md$ in the change folder
#   R2  design/ subdirectory containing at least one *.md
#   R3  tasks.md exists AND contains a Markdown checkbox (^\s*-\s+\[[ xX]\]\s)
#
# Gate: when the CLI JSON reports `.schemaName == "pi-spec-driven"` the
# override is skipped entirely (design is authored, never inferred).
# See change: add-pi-spec-driven-schema.
#
# See change: fix-openspec-design-detection.

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: effective-status.sh <change-name>" >&2
  exit 2
fi

CHANGE="$1"
CHANGE_DIR="openspec/changes/${CHANGE}"

# Pull raw status from openspec CLI.
RAW="$(openspec status --change "$CHANGE" --json 2>/dev/null || true)"

if [ -z "$RAW" ]; then
  # Pass through whatever the CLI gave us (likely empty / error).
  echo "$RAW"
  exit 0
fi

# Evaluate the three rules against the change folder.
satisfied=0

# R1: any file matching ^design.*\.md$ at the change-folder top level.
if [ -d "$CHANGE_DIR" ]; then
  while IFS= read -r f; do
    base="$(basename "$f")"
    case "$base" in
      design*.md) satisfied=1; break ;;
    esac
  done < <(find "$CHANGE_DIR" -maxdepth 1 -type f -name '*.md' 2>/dev/null)
fi

# R2: design/ subdir with at least one *.md.
if [ "$satisfied" -eq 0 ] && [ -d "$CHANGE_DIR/design" ]; then
  if find "$CHANGE_DIR/design" -maxdepth 1 -type f -name '*.md' -print -quit 2>/dev/null | grep -q .; then
    satisfied=1
  fi
fi

# R3: tasks.md with at least one Markdown checkbox.
if [ "$satisfied" -eq 0 ] && [ -f "$CHANGE_DIR/tasks.md" ]; then
  # Match: optional leading whitespace, "- ", then [ ] or [x] or [X], then whitespace.
  if grep -qE '^[[:space:]]*-[[:space:]]+\[[[:space:]xX]\][[:space:]]' "$CHANGE_DIR/tasks.md" 2>/dev/null; then
    satisfied=1
  fi
fi

# Schema gate (needs jq; without jq the raw output passes through anyway).
if command -v jq >/dev/null 2>&1 \
  && [ "$(echo "$RAW" | jq -r '.schemaName // empty' 2>/dev/null || true)" = "pi-spec-driven" ]; then
  echo "$RAW"
  exit 0
fi

# Apply override via jq if available; otherwise pass raw through.
if ! command -v jq >/dev/null 2>&1; then
  # No jq — be honest, return the raw CLI output unchanged. The dashboard
  # still applies the override server-side; this only affects skills that
  # ran on a host without jq installed.
  echo "$RAW"
  exit 0
fi

if [ "$satisfied" -eq 1 ]; then
  echo "$RAW" | jq '
    # Promote design ready→done.
    .artifacts |= map(if .id == "design" and .status == "ready" then .status = "done" else . end)
    # Re-derive isComplete: if every artifact is done, set true; never demote.
    | (if (.artifacts | length > 0 and (all(.status == "done")))
         then .isComplete = true
         else .
       end)
  '
else
  echo "$RAW"
fi
