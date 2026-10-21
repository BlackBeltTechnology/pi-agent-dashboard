#!/usr/bin/env bash
# Test orchestrator: clone → boot → wait SSH → run tests → destroy
# Usage: run-test.sh <platform> <base-image-dir> <ssh-user> <ssh-key> [ssh-timeout]
set -euo pipefail

PLATFORM="$1"
BASE_DIR="$2"
SSH_USER="$3"
SSH_KEY="$4"
SSH_TIMEOUT="${5:-120}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLONE_NAME="test-${PLATFORM}-$(date +%s)"

echo "╔══════════════════════════════════════════════╗"
echo "║  QA Test Run: ${PLATFORM}"
echo "║  Base image: ${BASE_DIR}"
echo "╚══════════════════════════════════════════════╝"

# Cleanup on exit (always destroy the clone)
cleanup() {
  echo ""
  echo "=== Cleaning up ==="
  "$SCRIPT_DIR/vm-destroy.sh" "$CLONE_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# 1. Clone base image
echo ""
echo "=== Cloning base image ==="
CLONE_VMX=$("$SCRIPT_DIR/vm-clone.sh" "$BASE_DIR" "$CLONE_NAME")

# 2. Wait for SSH
echo ""
echo "=== Waiting for SSH ==="
VM_IP=$("$SCRIPT_DIR/vm-wait-ssh.sh" "$CLONE_VMX" "$SSH_USER" "$SSH_KEY" "$SSH_TIMEOUT")

# 3. Determine which test runner to use
SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o BatchMode=yes ${SSH_USER}@${VM_IP}"

echo ""
echo "=== Uploading tests ==="
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r "$QA_DIR/tests" "${SSH_USER}@${VM_IP}:/tmp/qa-tests"

# The dist-only plugin scripts (47..51) pack their fixture plugins with this helper and look for it NEXT TO
# the scripts (they run from /tmp/qa-tests on the VM, where `qa/scripts` does not exist).
scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$SCRIPT_DIR/pack-fixture-plugin.mjs" "${SSH_USER}@${VM_IP}:/tmp/qa-tests/" >/dev/null
# Optional: a STAGED runtime canary (`node scripts/stage-runtime-canary.mjs --out <d> --mode untrusted`, then
# QA_CANARY_DIR=<d>/plugins/runtime-canary) for 47-plugin-runtime-dist-only.sh; it SKIPs when absent.
QA_ENV=""
if [ -n "${QA_CANARY_DIR:-}" ] && [ -f "${QA_CANARY_DIR}/package.json" ] && [[ "$PLATFORM" != windows* ]]; then
  echo "=== Uploading staged runtime canary ==="
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r "$QA_CANARY_DIR" "${SSH_USER}@${VM_IP}:/tmp/qa-canary" >/dev/null
  QA_ENV="QA_CANARY_DIR=/tmp/qa-canary "
fi

# Optional: upload Electron ZIP artifact for the V2 bootstrap test
# (qa/tests/07-electron-bootstrap-v2.ps1). The test skips when absent.
# Override location via QA_ELECTRON_ZIP env; default looks in the
# project's standard build output dir.
ELECTRON_ZIP="${QA_ELECTRON_ZIP:-$QA_DIR/../packages/electron/out/make/zip/x64/PI-Dashboard-win32-x64.zip}"
if [[ "$PLATFORM" == windows* ]] && [ -f "$ELECTRON_ZIP" ]; then
  echo "=== Uploading Electron ZIP artifact ==="
  echo "  source: $ELECTRON_ZIP"
  $SSH_CMD "mkdir -p C:/qa-artifacts || true" 2>/dev/null || true
  $SSH_CMD 'powershell -Command "New-Item -ItemType Directory -Force -Path C:\qa-artifacts | Out-Null"'
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no "$ELECTRON_ZIP" \
    "${SSH_USER}@${VM_IP}:C:/qa-artifacts/PI-Dashboard-win32-x64.zip"
elif [[ "$PLATFORM" == windows* ]]; then
  echo "=== No Electron ZIP found at $ELECTRON_ZIP — V2 bootstrap test will skip ==="
fi

echo ""
echo "=== Running tests ==="
if [[ "$PLATFORM" == windows* ]]; then
  # Windows: use PowerShell test runner
  $SSH_CMD "powershell -ExecutionPolicy Bypass -File /tmp/qa-tests/run-all.ps1"
else
  # Unix: use bash test runner
  $SSH_CMD "chmod +x /tmp/qa-tests/*.sh && ${QA_ENV}bash /tmp/qa-tests/run-all.sh"
fi

TEST_EXIT=$?

echo ""
echo "╔══════════════════════════════════════════════╗"
if [ $TEST_EXIT -eq 0 ]; then
  echo "║  ✅ ALL TESTS PASSED: ${PLATFORM}"
else
  echo "║  ❌ TESTS FAILED: ${PLATFORM} (exit: ${TEST_EXIT})"
fi
echo "╚══════════════════════════════════════════════╝"

exit $TEST_EXIT
