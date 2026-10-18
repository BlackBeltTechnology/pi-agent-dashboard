#!/usr/bin/env bash
# Test: Install pi-dashboard from npm
set -euo pipefail

echo "=== Test: npm install pi-dashboard ==="

# Source nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install pi-dashboard globally
npm install -g @blackbelt-technology/pi-dashboard

# Verify the binary is available
VERSION=$(pi-dashboard --version 2>&1 || true)
if [ -z "$VERSION" ]; then
  echo "FAIL: pi-dashboard --version returned empty"
  exit 1
fi

echo "pi-dashboard version: $VERSION"

# Verify node-pty compiled (it's a dependency)
# Check that the native module exists in the global node_modules
GLOBAL_DIR=$(npm root -g)
if [ ! -d "$GLOBAL_DIR/@blackbelt-technology/pi-dashboard" ]; then
  echo "FAIL: pi-dashboard not found in global modules"
  exit 1
fi

# --- pi lockstep floor (X4; changes: update-pi-core-1-1-adopt-apis, update-pi-core-1-3-adopt-apis) ---------
# Every resolved copy of the governed pi packages must sit at or above the 1.1.0
# floor; a copy left on an older pin means the lockstep (peers, overrides,
# server dependency) did not publish coherently.
PI_FLOOR="1.3.0"
BELOW=$(GLOBAL_DIR="$GLOBAL_DIR" PI_FLOOR="$PI_FLOOR" node -e '
const fs = require("fs"), path = require("path");
const floor = process.env.PI_FLOOR.split(".").map(Number);
const names = ["pi-coding-agent", "pi-ai", "pi-tui"];
const below = []; let found = 0;
(function walk(dir, depth) {
  if (depth > 8) return;
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (path.basename(dir) === "@earendil-works" && names.includes(e.name)) {
      try {
        const v = JSON.parse(fs.readFileSync(path.join(full, "package.json"), "utf8")).version;
        found++;
        const n = v.split("-")[0].split(".").map(Number);
        const lt = n[0] < floor[0] || (n[0] === floor[0] && (n[1] < floor[1] || (n[1] === floor[1] && n[2] < floor[2])));
        if (lt || v.includes("-")) below.push(full + "@" + v);
      } catch {}
      continue;
    }
    if (e.name === ".bin" || e.name === ".cache") continue;
    walk(full, depth + 1);
  }
})(process.env.GLOBAL_DIR + "/@blackbelt-technology", 0);
if (found === 0) below.push("no @earendil-works pi-coding-agent/pi-ai/pi-tui copy found");
console.log(below.join("\n"));
')
if [ -n "$BELOW" ]; then
  echo "FAIL: pi copies below the $PI_FLOOR floor (or none resolved):"
  echo "$BELOW"
  exit 1
fi
echo "Every resolved pi-coding-agent / pi-ai / pi-tui copy is at or above $PI_FLOOR"

# --- mcp.json integrity against the real filesystem (J7, J8) ---------------
# The dashboard no longer provisions mcp.json (pi sessions reach /mcp through a
# per-session pi.registerMcpServer registration — change
# migrate-mcp-to-pi-builtin); its only write is the startup removal of an old
# provisioned entry, which must leave the file valid. Asserted here rather than in a unit test because J7/J8 are about the REAL
# filesystem: a missing file, a real directory, real permissions.
MCP_JSON="$HOME/.pi/agent/mcp.json"
if [ -f "$MCP_JSON" ]; then
  # Must remain valid JSON after any dashboard write — a corrupted user config
  # would break every other MCP server the operator has configured.
  if ! node -e "JSON.parse(require('fs').readFileSync('$MCP_JSON','utf8'))" 2>/dev/null; then
    echo "FAIL: $MCP_JSON is not valid JSON after install"
    exit 1
  fi
  echo "$MCP_JSON is valid JSON"

  # J7 — an unwritable config directory must fail cleanly, never partially.
  # Verified by confirming no temp-file residue was left behind by a write.
  if ls "$HOME/.pi/agent/"mcp.json.*.tmp >/dev/null 2>&1; then
    echo "FAIL: a partially-written mcp.json temp file was left behind"
    exit 1
  fi
  echo "No partial mcp.json temp files left behind"
else
  # J8 — the dashboard never creates it. Absence here is correct.
  echo "NOTE: $MCP_JSON absent (the dashboard does not create it)"
fi

echo "PASS: pi-dashboard installed successfully"
