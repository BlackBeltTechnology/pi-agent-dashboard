#!/usr/bin/env bash
# Test: @blackbelt-technology/pi-dashboard-photocraft (deprecation shim -> craft-apps) installs and provisions on a clean VM.
#
# L2 smoke (macOS arm64/x64, Linux x86_64), change: add-photocraft-plugin
# (test-plan #E36, #E37). Catches what unit tests cannot:
#  - the packed bin starts from a plain shell with NO TypeScript loader
#  - `ensure` downloads + verifies + extracts the real release asset for this OS
#    (first run cacheHit:false, second cacheHit:true), no desktop executable on disk
#  - the real `photocraft-cli` runs headless (exec --version / run --new)
#  - the stdio MCP wrapper answers initialize + tools/list
#  - macOS: Gatekeeper field recorded; on an Intel VM the universal binary runs natively
# Needs network (GitHub). Hermetic: own PHOTOCRAFT_HOME, empty NODE_OPTIONS.
set -euo pipefail

echo "=== Test: pi-photocraft install + provisioning smoke ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK=$(mktemp -d -t pi-photocraft-XXXX)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

export NODE_OPTIONS=""
export PHOTOCRAFT_HOME="$WORK/photocraft-home"
unset PHOTOCRAFT_BIN PHOTOCRAFT_VERSION

cat > package.json <<'JSON'
{ "name": "photocraft-smoke", "version": "0.0.0", "private": true, "type": "module" }
JSON

set +e
npm install --no-audit --no-fund --silent @blackbelt-technology/pi-dashboard-photocraft
NPM_RC=$?
set -e
if [ "$NPM_RC" -ne 0 ]; then
  # Pre-publish QA fallback: pack the local workspaces (the photocraft shim + craft-apps + nano-banana).
  for pkg in nano-banana craft-apps photocraft; do
    if [ ! -d "$REPO_ROOT/packages/$pkg" ]; then
      echo "FAIL: npm install failed AND no local workspace packages/$pkg"
      exit 1
    fi
  done
  echo "NOTE: registry install failed (pre-publish?); packing the local workspaces"
  NB_TGZ=$(cd "$REPO_ROOT/packages/nano-banana" && npm pack --silent --pack-destination "$WORK" | tail -1)
  CA_TGZ=$(cd "$REPO_ROOT/packages/craft-apps" && npm pack --silent --pack-destination "$WORK" | tail -1)
  PC_TGZ=$(cd "$REPO_ROOT/packages/photocraft" && npm pack --silent --pack-destination "$WORK" | tail -1)
  npm install --no-audit --no-fund --silent "$WORK/$NB_TGZ" "$WORK/$CA_TGZ" "$WORK/$PC_TGZ"
fi

PC="$WORK/node_modules/.bin/pi-photocraft"
[ -x "$PC" ] || { echo "FAIL: $PC missing after install"; exit 1; }

# 1. bin runs without a TypeScript loader
"$PC" --help >/dev/null 2>"$WORK/help.err" || { echo "FAIL: pi-photocraft --help exited non-zero"; cat "$WORK/help.err"; exit 1; }
echo "OK: --help exits 0 (bin runs without a TS loader)"

# 2. ensure twice: cacheHit false then true
"$PC" ensure > "$WORK/r1.json"
"$PC" ensure > "$WORK/r2.json"
node -e '
  const r1 = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const r2 = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  if (r1.cacheHit !== false) { console.error("FAIL: first ensure cacheHit=" + r1.cacheHit); process.exit(1); }
  if (r2.cacheHit !== true) { console.error("FAIL: second ensure cacheHit=" + r2.cacheHit); process.exit(1); }
  if (process.platform === "darwin" && !r1.gatekeeper) { console.error("FAIL: no gatekeeper field on macOS install"); process.exit(1); }
  console.log("OK: ensure cacheHit false -> true (version " + r1.version + ", asset " + r1.asset + ")");
' "$WORK/r1.json" "$WORK/r2.json"

# 3. no desktop executable in the cache
if find "$PHOTOCRAFT_HOME" \( -name photocraft -o -name photocraft.exe \) -type f | grep -q .; then
  echo "FAIL: desktop executable present under $PHOTOCRAFT_HOME"
  exit 1
fi
echo "OK: no desktop executable in the cache"

# 4. the real CLI runs headless
VERSION_LINE=$("$PC" exec --version)
case "$VERSION_LINE" in
  "photocraft-cli "*) echo "OK: exec --version -> $VERSION_LINE" ;;
  *) echo "FAIL: unexpected --version output: $VERSION_LINE"; exit 1 ;;
esac
"$PC" exec run --new '{"width":64,"height":64}' --out "$WORK/x.png" >/dev/null
[ -s "$WORK/x.png" ] || { echo "FAIL: exec run did not write x.png"; exit 1; }
echo "OK: exec run --new wrote x.png"

# 5. MCP wrapper handshake + tool list
MCP_OUT=$( (printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; sleep 3) | "$PC" mcp --root "$WORK" 2>/dev/null )
echo "$MCP_OUT" | node -e '
  const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const init = lines.find((m) => m.id === 1), list = lines.find((m) => m.id === 2);
  if (!init || init.result.serverInfo.name !== "photocraft") { console.error("FAIL: bad initialize result"); process.exit(1); }
  const names = ((list && list.result.tools) || []).map((t) => t.name);
  if (!names.includes("doc_open") || !names.includes("command_run")) { console.error("FAIL: tool list " + names.join(",")); process.exit(1); }
  console.log("OK: MCP handshake + " + names.length + " tools");
'

# 6. E37: Intel macOS runs the universal binary's native slice
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "x86_64" ]; then
  TRANSLATED=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
  if [ "$TRANSLATED" != "0" ]; then
    echo "FAIL: running under Rosetta (proc_translated=$TRANSLATED); not a native Intel VM"
    exit 1
  fi
  echo "OK: macOS x86_64 native, universal binary ran ($VERSION_LINE)"
fi

echo "PASS: pi-photocraft installs and provisions on this platform"
