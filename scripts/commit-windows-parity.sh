#!/usr/bin/env bash
#
# Stage and commit the fix-windows-server-parity + consolidate-platform-handlers
# work in logical, reviewable chunks that match this repo's commit style
# (see `git log --oneline` — lowercase conventional prefixes, imperative mood,
# no trailing period, one concern per commit).
#
# Usage:
#   bash scripts/commit-windows-parity.sh        # run all stages
#   bash scripts/commit-windows-parity.sh dry    # show what would be committed
#   bash scripts/commit-windows-parity.sh 3      # run only stage 3
#
# Each stage is independent; between stages the tree is a valid checkpoint.

set -euo pipefail

# cd to the repo root by anchoring on the script's own location.
# Script lives at <repo>/scripts/commit-windows-parity.sh, so the repo
# root is one directory up. This works regardless of the caller's CWD
# (including invocation from $HOME or anywhere outside the repo).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Sanity check — bail loudly if we're somehow not in a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: $REPO_ROOT is not a git repository" >&2
  exit 1
fi

MODE="${1:-all}"   # all | dry | 1..5

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

commit_stage() {
  local num="$1"
  local msg="$2"
  shift 2
  local files=("$@")

  echo
  echo "━━━ Stage ${num}: ${msg}"
  echo "    ${#files[@]} path(s)"

  if [[ "$MODE" == "dry" ]]; then
    printf '      %s\n' "${files[@]}"
    return 0
  fi

  if [[ "$MODE" != "all" && "$MODE" != "$num" ]]; then
    echo "    (skipped — stage $MODE selected)"
    return 0
  fi

  # Reset the index so previous stages don't leak into this commit
  git reset -q

  # Stage only the files for this commit. Use -A so deletes/renames are captured.
  git add -A -- "${files[@]}"

  # Nothing to commit? (files unchanged on disk)
  if git diff --cached --quiet; then
    echo "    (nothing staged — skipped)"
    return 0
  fi

  git commit -m "$msg"
}

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — The core Windows-parity fix (fix: prefix)
#
# All production code + new helpers + new tests from the archived change
# `fix-windows-server-parity`, plus the platform/process migration in the
# same call sites (step 2 of consolidate-platform-handlers). Grouped because
# they touch the same files and ship the same behavior.
# ─────────────────────────────────────────────────────────────────────────────

commit_stage 1 "fix: cross-platform server launch, restart, and stale-port cleanup on Windows" \
  packages/shared/src/resolve-jiti.ts \
  packages/shared/src/platform/ \
  packages/shared/src/tool-resolver.ts \
  packages/shared/src/__tests__/resolve-jiti.test.ts \
  packages/shared/src/__tests__/platform-process.test.ts \
  packages/shared/src/__tests__/tool-resolver.test.ts \
  packages/shared/src/__tests__/binary-lookup.test.ts \
  packages/server/src/cli.ts \
  packages/server/src/restart-helper.ts \
  packages/server/src/routes/system-routes.ts \
  packages/server/src/editor-detection.ts \
  packages/server/src/session-diff.ts \
  packages/server/src/browser-handlers/session-action-handler.ts \
  packages/server/src/headless-pid-registry.ts \
  packages/server/src/__tests__/find-port-holders.test.ts \
  packages/server/src/__tests__/is-pi-process.test.ts \
  packages/server/src/__tests__/restart-helper.test.ts \
  packages/extension/src/server-launcher.ts \
  packages/extension/src/server-auto-start.ts \
  packages/extension/src/__tests__/server-auto-start.test.ts \
  packages/electron/src/lib/server-lifecycle.ts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Cross-platform test hygiene (test: prefix)
#
# Tests that had Unix-only assumptions baked in (HOME without USERPROFILE,
# posix path separators in expected values, `:` PATH delimiter, `which` mocks
# that ignored `where`, Zed-centric editor fixtures). No production change.
# ─────────────────────────────────────────────────────────────────────────────

commit_stage 2 "test: fix cross-platform assumptions in test fixtures (Windows parity)" \
  packages/shared/src/__tests__/config.test.ts \
  packages/shared/src/__tests__/session-meta.test.ts \
  packages/shared/src/__tests__/bridge-register.test.ts \
  packages/server/src/__tests__/auth.test.ts \
  packages/server/src/__tests__/bridge-register-nondestructive.test.ts \
  packages/server/src/__tests__/browse-endpoint.test.ts \
  packages/server/src/__tests__/client-discovery.test.ts \
  packages/server/src/__tests__/config-api.test.ts \
  packages/server/src/__tests__/editor-registry.test.ts \
  packages/server/src/__tests__/extension-register.test.ts \
  packages/server/src/__tests__/file-endpoint.test.ts \
  packages/server/src/__tests__/headless-pid-registry.test.ts \
  packages/server/src/__tests__/known-servers-routes.test.ts \
  packages/server/src/__tests__/process-manager.test.ts \
  packages/server/src/__tests__/recommended-routes.test.ts \
  packages/server/src/__tests__/terminal-manager.test.ts \
  packages/server/src/__tests__/trusted-networks-config.test.ts \
  packages/extension/src/__tests__/process-scanner.test.ts \
  packages/electron/src/__tests__/dependency-detector.test.ts \
  packages/electron/src/__tests__/jiti-fallback.test.ts \
  packages/electron/src/__tests__/known-servers-config.test.ts \
  packages/electron/src/__tests__/recommended-enricher.test.ts \
  packages/electron/src/__tests__/recommended-wizard.test.ts \
  packages/electron/src/__tests__/smart-startup.test.ts \
  packages/electron/src/__tests__/wizard-state.test.ts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — Docs (docs: prefix)
#
# README troubleshooting section, AGENTS.md platform/restart notes,
# architecture.md rewritten Graceful Restart + new Cross-Platform Server Launch
# and Server Log Hygiene sections.
# ─────────────────────────────────────────────────────────────────────────────

commit_stage 3 "docs: document cross-platform server launch, restart, and log hygiene" \
  AGENTS.md \
  README.md \
  docs/architecture.md

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4 — Archived OpenSpec change (docs: prefix)
#
# The completed fix-windows-server-parity change, moved to archive with
# synced main specs. Kept as its own commit so the archive move is reviewable
# in isolation.
# ─────────────────────────────────────────────────────────────────────────────

commit_stage 4 "docs: archive fix-windows-server-parity change and sync main specs" \
  openspec/changes/archive/ \
  openspec/specs/bridge-extension/spec.md \
  openspec/specs/dashboard-server/spec.md \
  openspec/specs/editor-detection/spec.md

# ─────────────────────────────────────────────────────────────────────────────
# Stage 5 — New OpenSpec proposal (docs: prefix)
#
# The in-progress consolidate-platform-handlers change (proposal, design,
# specs, tasks). Step 1 and step 2 of its tasks.md are checked off — the
# implementation for those steps lives in stage 1.
# ─────────────────────────────────────────────────────────────────────────────

commit_stage 5 "docs: add consolidate-platform-handlers openspec proposal" \
  openspec/changes/consolidate-platform-handlers/

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────

echo
if [[ "$MODE" == "dry" ]]; then
  echo "━━━ Dry run complete — nothing committed."
else
  echo "━━━ All stages complete."
  git log --oneline -6
fi
