#!/usr/bin/env bash
#
# Spike: verify `bundle-server.mjs --source-only` produces a working server bundle.
#
# Answers the design question for change `add-ci-electron-on-demand-build` (task 1):
# does the source-only mode (no host-side `npm install`) yield a bundle that boots
# under the existing `test-server-launch.sh` Docker harness?
#
# What it does:
#   1. Backs up any existing `packages/electron/resources/server/` directory.
#   2. Runs the bundler with --source-only and inspects the produced layout.
#   3. Hands the bundle to the existing Docker boot harness.
#   4. Restores the previous bundle (always — even on failure).
#
# Non-destructive. Exits 0 on spike PASS, 1 on FAIL, 2 on harness error.
#
# Usage:
#   bash packages/electron/scripts/spike-source-only-bundle.sh
#   bash packages/electron/scripts/spike-source-only-bundle.sh --keep-bundle   # skip restore
#   bash packages/electron/scripts/spike-source-only-bundle.sh --skip-docker   # bundle inspect only
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$ELECTRON_DIR/../.." && pwd)"
BUNDLE_DIR="$ELECTRON_DIR/resources/server"
BACKUP_DIR="$ELECTRON_DIR/resources/server.spike-bak"

KEEP_BUNDLE=0
SKIP_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --keep-bundle) KEEP_BUNDLE=1 ;;
    --skip-docker) SKIP_DOCKER=1 ;;
    -h|--help)
      sed -n '3,20p' "$0"
      exit 0
      ;;
    *) echo "::error::unknown flag: $arg" >&2; exit 2 ;;
  esac
done

bar() { printf '═%.0s' $(seq 1 70); echo; }
step() { echo; bar; echo "  $*"; bar; }

PASS=0
FAIL=0
record_pass() { PASS=$((PASS+1)); echo "  ✓ $*"; }
record_fail() { FAIL=$((FAIL+1)); echo "  ✗ $*"; }

# ── Phase 0: prerequisites ────────────────────────────────────────────────
step "Phase 0 — prerequisites"

if [ ! -f "$ELECTRON_DIR/scripts/bundle-server.mjs" ]; then
  echo "::error::bundle-server.mjs not found at $ELECTRON_DIR/scripts/" >&2
  exit 2
fi
record_pass "bundle-server.mjs present"

if [ ! -f "$ELECTRON_DIR/scripts/test-server-launch.sh" ]; then
  echo "::error::test-server-launch.sh not found — harness missing" >&2
  exit 2
fi
record_pass "test-server-launch.sh present"

if [ "$SKIP_DOCKER" -eq 0 ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "::error::docker not on PATH (use --skip-docker for bundle-inspect only)" >&2
    exit 2
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "::error::docker daemon not reachable (use --skip-docker for bundle-inspect only)" >&2
    exit 2
  fi
  record_pass "docker available"
fi

# ── Phase 1: back up any existing bundle ──────────────────────────────────
step "Phase 1 — back up existing bundle (if any)"

if [ -d "$BUNDLE_DIR" ]; then
  if [ -d "$BACKUP_DIR" ]; then
    echo "::error::stale backup at $BACKUP_DIR — refusing to overwrite. Remove it manually." >&2
    exit 2
  fi
  mv "$BUNDLE_DIR" "$BACKUP_DIR"
  record_pass "moved existing bundle → $BACKUP_DIR"
  HAD_PRIOR=1
else
  record_pass "no existing bundle to preserve"
  HAD_PRIOR=0
fi

# Always restore on exit, regardless of outcome — unless --keep-bundle.
restore_bundle() {
  local rc=$?
  if [ "$KEEP_BUNDLE" -eq 1 ]; then
    echo
    echo "  (--keep-bundle: leaving $BUNDLE_DIR in place)"
    if [ "$HAD_PRIOR" -eq 1 ]; then
      echo "  (prior bundle preserved at $BACKUP_DIR)"
    fi
    exit $rc
  fi
  echo
  echo "  Restoring prior bundle state..."
  rm -rf "$BUNDLE_DIR" 2>/dev/null || true
  if [ "$HAD_PRIOR" -eq 1 ] && [ -d "$BACKUP_DIR" ]; then
    mv "$BACKUP_DIR" "$BUNDLE_DIR"
    echo "  ✓ restored from backup"
  else
    echo "  ✓ removed spike bundle (no prior to restore)"
  fi
  exit $rc
}
trap restore_bundle EXIT INT TERM

# ── Phase 2: run bundler in source-only mode ──────────────────────────────
step "Phase 2 — bundle-server.mjs --source-only"

cd "$PROJECT_DIR"
if ! node "$ELECTRON_DIR/scripts/bundle-server.mjs" --source-only 2>&1 | tail -40; then
  record_fail "bundle-server.mjs --source-only exited non-zero"
  exit 1
fi
record_pass "bundler completed"

if [ ! -d "$BUNDLE_DIR" ]; then
  record_fail "bundle directory not created at $BUNDLE_DIR"
  exit 1
fi
record_pass "bundle directory created"

# ── Phase 3: structural assertions ────────────────────────────────────────
step "Phase 3 — bundle structure"

check_path() {
  if [ -e "$BUNDLE_DIR/$1" ]; then
    record_pass "exists: $1"
  else
    record_fail "missing: $1"
  fi
}

check_path "package.json"
check_path "packages/server/src"
check_path "packages/shared/src"
check_path "packages/extension/src"

# Source-only SHOULD skip the host npm install. If node_modules is fully
# populated, the mode didn't actually skip anything — surface as a soft
# warning rather than failure (the boot test is the real verdict).
if [ -d "$BUNDLE_DIR/node_modules" ]; then
  count=$(find "$BUNDLE_DIR/node_modules" -maxdepth 2 -name package.json 2>/dev/null | wc -l | tr -d ' ')
  echo "  ℹ node_modules present ($count packages) — source-only mode partial?"
else
  record_pass "node_modules absent (source-only true to its name)"
fi

# @blackbelt-technology symlink materialisation (per bundle-server.mjs lines 327-403)
if [ -d "$BUNDLE_DIR/node_modules/@blackbelt-technology" ]; then
  bb_count=$(ls "$BUNDLE_DIR/node_modules/@blackbelt-technology" 2>/dev/null | wc -l | tr -d ' ')
  echo "  ℹ @blackbelt-technology/ has $bb_count entries"
fi

echo
echo "  Bundle size:"
du -sh "$BUNDLE_DIR" 2>/dev/null | sed 's/^/    /'

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "::error::Phase 3 found $FAIL structural problems — aborting before Docker"
  exit 1
fi

# ── Phase 4: Docker boot test ─────────────────────────────────────────────
if [ "$SKIP_DOCKER" -eq 1 ]; then
  step "Phase 4 — SKIPPED (--skip-docker)"
  echo "  Spike: PARTIAL (bundle structure OK, boot not verified)"
  exit 0
fi

step "Phase 4 — Docker boot test (existing test-server-launch.sh harness)"

# The existing harness runs interactively; we want unattended.
# Wrap it so the test script's `-it` flag doesn't choke a non-TTY runner.
if [ -t 0 ]; then
  bash "$ELECTRON_DIR/scripts/test-server-launch.sh" 2>&1 | tee /tmp/spike-source-only.log
  HARNESS_RC=${PIPESTATUS[0]}
else
  # Non-interactive: strip -it from the docker run inside the harness by
  # piping a TTY-less stdin. The harness uses `docker run --rm -it` which
  # tolerates no TTY when stdin is closed.
  bash "$ELECTRON_DIR/scripts/test-server-launch.sh" </dev/null 2>&1 | tee /tmp/spike-source-only.log
  HARNESS_RC=${PIPESTATUS[0]}
fi

# ── Phase 5: verdict ──────────────────────────────────────────────────────
step "Phase 5 — verdict"

if [ "$HARNESS_RC" -ne 0 ]; then
  record_fail "Docker harness exited $HARNESS_RC"
  echo
  echo "  Last 60 lines of /tmp/spike-source-only.log:"
  tail -60 /tmp/spike-source-only.log | sed 's/^/    /'
  echo
  echo "::error::Spike: FAIL — --source-only bundle did not boot or serve /api/health."
  echo "         Document fallback in design.md (npm install --offline --prefer-offline)."
  exit 1
fi

# The harness's exit code is now load-bearing — Test 8 (jiti launch +
# /api/health probe) is the real verdict and its exit propagates. The
# earlier tests (2–4, tsx-based) are kept as diagnostics and may emit
# SyntaxError markers that DO NOT indicate failure; ignore them.
if ! grep -q 'Test 8 PASS' /tmp/spike-source-only.log; then
  record_fail "harness exited 0 but Test 8 PASS marker missing — protocol drift?"
  echo
  echo "::error::Spike: FAIL — expected 'Test 8 PASS' line not found in log."
  exit 1
fi

echo
echo "  ✓ harness exited cleanly"
echo "  ✓ Test 8 (jiti boot + /api/health) PASS marker found"
echo
echo "  Spike: PASS — --source-only bundle boots under the Docker harness."
echo "  Design decision in openspec/changes/add-ci-electron-on-demand-build/design.md"
echo "  (Decision 3) is empirically supported. Safe to set source_only_bundle: true"
echo "  as the default for ci-electron.yml."
exit 0
