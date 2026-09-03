#!/usr/bin/env bash
# Run all QA tests in order, collect results, print summary
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source nvm for all tests
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

TESTS=(
  "01-install.sh"
  "02-server-start.sh"
  "03-websocket.sh"
  "04-ws-ticket-auth.sh"  # bus-client connect ticket path. See change: add-dashboard-bus-client-scripting.
  "04-terminal.sh"
  "05-git-ops.sh"
  "08-electron-real-launch.sh"  # skips when AppImage absent. See change: expand-electron-qa-coverage.
  "09-image-fit-extension.sh"   # @blackbelt-technology/pi-image-fit install + dep-tree sanity. See change: pi-image-fit-extension.
  "10-faux-model.sh"            # faux prompt round-trip; skips (SKIP: + exit 0) when pi absent. See change: add-faux-model-integration-tests.
  "13-openspec-offline-regen.sh" # offline `npx --no-install openspec init` regen stamps generatedBy 1.6.0. See change: provision-openspec-cli-in-sessions.
  "14-pi-resources-parity.sh"   # /api/pi-resources p95 budget + companion-file / bundled-command probes. See change: fix-skill-discovery-parity.
  "15-omit-dev-build.sh"        # `npm/pnpm install --omit=dev` client build (#357); arm 2 skips below Node 26. See change: fix-pi-install-node26-and-omit-dev-build.
  "17-bridge-contention.sh"     # duplicate bridge refused terminally for a held session id (#X10). See change: fix-duplicate-bridge-registration.
  "18-server-port-hygiene.sh"   # a losing server leaves no port held (#E1, #E22). See change: fix-worktree-server-autostart-leak.
  "19-tmux-spawn-injection.sh"  # adversarial workspace names do not execute; pane honours the resolved runtime (#X1-X3, #X6). Skips when tmux absent. See change: select-pi-runtime-install.
  "21-gateway-rendezvous.sh"    # the HOME rendezvous record survives a SIGKILLed owner and a clean exit (#X5, #X6). Hermetic: own throwaway $HOME. See change: add-pi-gateway-transport-identity.
  "23-gateway-socket-fallback.sh" # an unrepresentable socket path falls back to loopback + token, never discovery (#X17). See change: add-pi-gateway-transport-identity.
  "24-gateway-where.sh"         # /dashboard-where reports endpoint + instance id + pinned (#F7); skips when pi absent. See change: add-pi-gateway-transport-identity.
  "30-gateway-instance-mismatch.sh" # a record naming one instance, another answering: refused, both ids named, no substitute (D14, task 5.4b); skips when pi absent. See change: add-pi-gateway-transport-identity.
  "31-roles-read-api.sh"        # GET /api/roles answerable with ZERO sessions (#X8). See change: add-roles-read-api.
  # 25-gateway-remote-join-perf.sh and 26-gateway-promotion-soak.sh are OPT-IN:
  # one moves ~1 GB through a socket, the other soaks for ten minutes.
)

PASSED=0
FAILED=0
RESULTS=()

echo "╔══════════════════════════════════════════════╗"
echo "║           QA Test Suite                      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

for test in "${TESTS[@]}"; do
  TEST_PATH="$SCRIPT_DIR/$test"
  if [ ! -f "$TEST_PATH" ]; then
    echo "SKIP: $test (not found)"
    RESULTS+=("SKIP  $test")
    continue
  fi

  echo "────────────────────────────────────────────────"
  echo "Running: $test"
  echo "────────────────────────────────────────────────"

  # 08 prints "SKIP: ..." + exit 0 when AppImage absent; render as SKIP
  # in the summary rather than PASS so missing artifacts are visible.
  TEST_OUT=$(bash "$TEST_PATH" 2>&1)
  TEST_RC=$?
  echo "$TEST_OUT"
  if [ "$TEST_RC" -eq 0 ] && echo "$TEST_OUT" | head -1 | grep -q '^SKIP:'; then
    RESULTS+=("SKIP  $test")
  elif [ "$TEST_RC" -eq 0 ]; then
    PASSED=$((PASSED + 1))
    RESULTS+=("PASS  $test")
  else
    FAILED=$((FAILED + 1))
    RESULTS+=("FAIL  $test")
  fi
  echo ""
done

# Cleanup: stop server if running
pi-dashboard stop 2>/dev/null || true

# Print summary
TOTAL=$((PASSED + FAILED))
echo "╔══════════════════════════════════════════════╗"
echo "║           Test Results                       ║"
echo "╠══════════════════════════════════════════════╣"
for result in "${RESULTS[@]}"; do
  printf "║  %-42s ║\n" "$result"
done
echo "╠══════════════════════════════════════════════╣"
printf "║  Total: %-3d  Passed: %-3d  Failed: %-3d      ║\n" "$TOTAL" "$PASSED" "$FAILED"
echo "╚══════════════════════════════════════════════╝"

if [ $FAILED -gt 0 ]; then
  exit 1
fi
exit 0
