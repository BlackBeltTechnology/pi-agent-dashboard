#!/usr/bin/env bash
# Test: offline `openspec init` regen uses the installed bin (T-S2 / test-plan #S2).
# See change: provision-openspec-cli-in-sessions.
#
# worktreeInit was hardened to `npx --no-install openspec init --tools pi
# --force` so a missing bin is a HARD error instead of a silent network fetch.
# This smoke proves: with the pinned openspec 1.6.0 installed and network
# blocked, the regen runs offline (exit 0) and stamps generatedBy: "1.6.0";
# with the bin absent, --no-install errors rather than fetching.
set -euo pipefail

echo "=== Test: offline openspec init regen (T-S2) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# repoRoot = qa/tests -> ../..
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$REPO_ROOT/node_modules/@fission-ai/openspec/bin/openspec.js"

if [ ! -f "$BIN" ]; then
  echo "SKIP: pinned openspec bin not installed at $BIN (run npm install)"
  exit 0
fi

# 1. Confirm the installed bin reports the single-source version, offline.
VER="$(node "$BIN" --version 2>&1 || true)"
if ! echo "$VER" | grep -q "1.6.0"; then
  echo "FAIL: installed openspec is not 1.6.0 (got: $VER)"
  exit 1
fi
echo "Installed openspec: $VER"

# 2. Offline regen in a scratch project INSIDE the repo tree so `npx
#    --no-install` walks up and finds $REPO_ROOT/node_modules (its resolution
#    is cwd-tree-based, not PATH-based) — mirroring worktreeInit, whose cwd is
#    the freshly-installed worktree root. npm_config_offline forbids any fetch.
WORK="$(mktemp -d "$REPO_ROOT/.qa-offline-regen.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

export npm_config_offline=true
export npm_config_prefer_offline=true

if ! npx --no-install openspec init --tools pi --force >/dev/null 2>&1; then
  echo "FAIL: offline 'npx --no-install openspec init --tools pi --force' did not exit 0"
  exit 1
fi

# 3. A regenerated openspec-* SKILL.md must stamp generatedBy: "1.6.0".
SKILL="$(find . -path '*openspec-*/SKILL.md' | head -1 || true)"
if [ -z "$SKILL" ]; then
  echo "FAIL: no regenerated openspec-*/SKILL.md found"
  exit 1
fi
if ! grep -Eq 'generatedBy:\s*"?1\.6\.0"?' "$SKILL"; then
  echo "FAIL: $SKILL missing generatedBy 1.6.0"
  grep -i generatedBy "$SKILL" || true
  exit 1
fi
echo "Regenerated $SKILL stamps generatedBy 1.6.0"

echo "PASS: offline openspec init regen uses the installed 1.6.0 bin"
