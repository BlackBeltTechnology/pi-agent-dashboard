#!/usr/bin/env bash
# Test: POST /api/openspec/init — resolver + `--tools pi` chain (VM smoke).
#
# X8  — a bare `openspec` 0.0.0 squatted stub placed EARLIER on PATH must NOT
#       be used: the endpoint resolves the binary through the tool-registry
#       (bundled `@fission-ai/openspec` wins before PATH). Proven by marker:
#       the stub writes a marker file if it is ever invoked; after a
#       successful init the marker is absent and the REAL skills exist.
# X12 — end-to-end skills chain: init via the endpoint writes
#       `.pi/skills/openspec-explore/SKILL.md` AND `.pi/prompts/opsx-*.md`,
#       proving `--tools pi` survived argv construction (omitting it
#       reproduces the dead-buttons defect), and the cwd's update status
#       converges to `up-to-date` (signature recorded on init).
#
# See change: add-openspec-init-affordances (test-plan X8, X12).
set -euo pipefail

echo "=== Test: openspec init endpoint (X8 + X12) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PORT="${DASHBOARD_PORT:-8000}"
BASE="http://localhost:${PORT}"

WORK="$(mktemp -d)"
TARGET="$WORK/target"
mkdir -p "$TARGET"

# ── X8 setup: squatted 0.0.0 stub earlier on PATH ────────────────────────────
STUB_BIN="$WORK/stub-bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/openspec" << 'EOF'
#!/usr/bin/env bash
echo "stub invoked: $*" >> "${OPENSPEC_STUB_MARKER:-/tmp/openspec-stub-marker}"
exit 42
EOF
chmod +x "$STUB_BIN/openspec"
STUB_MARKER="$WORK/stub-marker"
export OPENSPEC_STUB_MARKER="$STUB_MARKER"

# ── Seed the preferences store so TARGET is a pinned (known) directory ──────
# The init endpoint validates against union(session cwds, pinned dirs); a
# freshly-started server with an empty store has neither.
PI_DIR="$HOME/.pi/dashboard"
mkdir -p "$PI_DIR"
# MERGE into an existing preferences file — never truncate a user's store
# (CodeRabbit round: `cat >` would clobber every other key).
node -e '
const fs = require("fs");
const p = process.argv[1] + "/preferences.json";
const target = process.argv[2];
let d = {};
try { d = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* fresh store */ }
const pins = Array.isArray(d.pinnedDirectories) ? d.pinnedDirectories : [];
if (!pins.includes(target)) pins.push(target);
d.pinnedDirectories = pins;
fs.writeFileSync(p, JSON.stringify(d, null, 2));
console.log("seeded pin:", target);
' "$PI_DIR" "$TARGET"

PATH="$STUB_BIN:$PATH" pi-dashboard start &
SERVER_PID=$!
cleanup() {
  pi-dashboard stop 2>/dev/null || true
  kill $SERVER_PID 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Wait for the server.
ELAPSED=0
while [ $ELAPSED -lt 30 ]; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" 2>/dev/null || echo 000)" = "200" ] && break
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done
if [ $ELAPSED -ge 30 ]; then
  echo "FAIL: server did not come up on $BASE"
  exit 1
fi


# ── POST /api/openspec/init ──────────────────────────────────────────────────
HTTP_CODE="$(curl -s -o "$WORK/init-resp.json" -w '%{http_code}' \
  -X POST "$BASE/api/openspec/init" \
  -H 'content-type: application/json' \
  -d "{\"cwd\": \"$TARGET\"}")"
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: POST /api/openspec/init returned $HTTP_CODE:"
  cat "$WORK/init-resp.json"
  exit 1
fi

# X8: the stub must never have been invoked…
if [ -f "$STUB_MARKER" ]; then
  echo "FAIL: squatted PATH stub was invoked instead of the tool-registry binary"
  cat "$STUB_MARKER"
  exit 1
fi

# X12: `--tools pi` survived — the REAL CLI wrote skills + prompts.
if [ ! -f "$TARGET/.pi/skills/openspec-explore/SKILL.md" ]; then
  echo "FAIL: .pi/skills/openspec-explore/SKILL.md missing after init (--tools pi lost?)"
  ls -la "$TARGET/.pi" 2>/dev/null || true
  exit 1
fi
if ! ls "$TARGET"/.pi/prompts/opsx-*.md >/dev/null 2>&1; then
  echo "FAIL: .pi/prompts/opsx-*.md missing after init (--tools pi lost?)"
  exit 1
fi
# …and the project side of init exists too.
if [ ! -d "$TARGET/openspec/changes" ]; then
  echo "FAIL: $TARGET/openspec/changes missing after init"
  exit 1
fi

# X12b/E27: signature recorded on init → update status is `up-to-date`
# (a freshly initialized project must not report `unknown` forever, and
# `unknown` must never present as stale).
sleep 1
STATUS="$(curl -s "$BASE/api/openspec/update-status")"
if ! echo "$STATUS" | TARGET="$TARGET" python3 -c "
import json,sys,os
data=json.load(sys.stdin)
rows=data.get('data',data) if isinstance(data,dict) else data
statuses=[r['status'] for r in rows if r.get('cwd')==os.environ['TARGET']]
sys.exit(0 if statuses==['up-to-date'] else 1)"; then
  echo "FAIL: update-status for target is not up-to-date after init:"
  echo "$STATUS"
  exit 1
fi

echo "PASS: openspec init endpoint (X8 stub avoided, X12 skills chain intact, status up-to-date)"
