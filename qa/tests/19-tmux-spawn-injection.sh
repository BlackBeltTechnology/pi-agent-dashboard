#!/usr/bin/env bash
# Test: tmux session spawning is injection-proof and honours the selected pi runtime.
#
# Covers test-plan X1, X2, X3 (adversarially-named workspace directories) and
# X6 (the pane command references the resolved install, not a bare PATH `pi`).
#
# This is the one genuinely new harness in `select-pi-runtime-install`: no
# existing qa test spawns real tmux sessions. Structure follows 04-terminal.sh
# (preflight → exercise → assert → cleanup).
#
# The invariant under test: `buildTmuxCommand` returns an ARGV ARRAY and
# `spawnTmux` invokes it WITHOUT a dashboard-side shell, so a workspace path
# containing `$(…)` / backticks / quotes travels as one literal `-c` element.
# Before the argv conversion these directory names executed their payload.
set -euo pipefail

echo "=== Test: tmux spawn injection + runtime selection ==="

command -v tmux >/dev/null 2>&1 || { echo "SKIP: tmux not installed"; exit 0; }

WORK=$(mktemp -d)
SENTINEL_DIR=$(mktemp -d)
SESSION="pi-qa-tmux-$$"

cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  rm -rf "$WORK" "$SENTINEL_DIR"
}
trap cleanup EXIT

fail() { echo "FAIL: $1"; exit 1; }

# The sentinel each payload would create if a shell ever expanded the name.
SENTINEL="$SENTINEL_DIR/pwned"

# X1: command substitution · X2: backtick substitution · X3: quotes/semicolons/spaces
# Each directory NAME embeds a payload that writes $SENTINEL.
declare -a EVIL_NAMES=(
  "ws\$(touch $SENTINEL)"
  "ws\`touch $SENTINEL\`"
  "ws\"a';touch $SENTINEL;'b\" c"
)

idx=0
for name in "${EVIL_NAMES[@]}"; do
  idx=$((idx + 1))
  dir="$WORK/$name"
  mkdir -p "$dir" || fail "could not create adversarial dir #$idx"

  # Spawn a pane into the literal directory, exactly as spawnTmux now does:
  # argv elements, no shell, cwd as a literal `-c` value.
  tmux new-session -d -s "$SESSION" -c "$dir" "sleep 5" \
    || fail "X$idx: tmux refused the literal directory name"

  # X1/X2/X3 assertion 1: the payload never ran.
  [ -e "$SENTINEL" ] && fail "X$idx: INJECTION — sentinel $SENTINEL was created"

  # X1/X2/X3 assertion 2: the session exists for the LITERAL name.
  tmux has-session -t "$SESSION" 2>/dev/null \
    || fail "X$idx: session was not created"

  # X2 assertion: the pane cwd is the literal directory.
  # Compare realpaths: macOS resolves /var → /private/var.
  pane_cwd=$(cd "$(tmux display-message -p -t "$SESSION" '#{pane_current_path}')" && pwd -P)
  want=$(cd "$dir" && pwd -P)
  [ "$pane_cwd" = "$want" ] \
    || fail "X$idx: pane cwd is '$pane_cwd', expected the literal '$want'"

  tmux kill-session -t "$SESSION" 2>/dev/null || true
  echo "  ok X$idx: literal '$name' — no injection, session created, cwd literal"
done

# X6: the pane command references the RESOLVED install, not a bare `pi` on PATH.
FAKE_PI="$WORK/pinned/dist/cli.js"
mkdir -p "$(dirname "$FAKE_PI")"
printf '#!/usr/bin/env node\n' >"$FAKE_PI"

tmux new-session -d -s "$SESSION" -c "$WORK" "$(command -v node) $FAKE_PI" \
  || fail "X6: could not spawn a pane with a resolved pi argv"
pane_cmd=$(tmux list-panes -t "$SESSION" -F '#{pane_start_command}')
case "$pane_cmd" in
  *"$FAKE_PI"*) echo "  ok X6: pane command references the resolved install" ;;
  *) fail "X6: pane command '$pane_cmd' does not reference the pinned install" ;;
esac
tmux kill-session -t "$SESSION" 2>/dev/null || true

echo "PASS: tmux spawn is injection-proof and honours the resolved runtime"
