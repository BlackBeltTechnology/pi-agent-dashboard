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

# --- MCP adapter version floor, against the real installed tree ------------
# See change: add-dashboard-mcp-server.
#
# The dashboard MCP endpoint speaks protocol 2026-07-28 only, and
# pi-mcp-adapter below 2.20.0 defaults to the LEGACY handshake. The resulting
# failure is a silent handshake hang, so the floor is surfaced as a diagnostic
# rather than left to be discovered at runtime (X1-X3).
MCP_ADAPTER_FLOOR="2.20.0"
ADAPTER_VERSION=$(npm ls -g pi-mcp-adapter --depth=0 2>/dev/null | sed -n 's/.*pi-mcp-adapter@\([0-9][0-9.]*\).*/\1/p' | head -1)

if [ -z "$ADAPTER_VERSION" ]; then
  # X3 — absent adapter. NOT a failure: the endpoint serves external clients
  # (Claude Desktop, Cursor) without a local adapter. Only the local-pi path
  # needs the floor, so this is reported, not fatal.
  echo "NOTE: pi-mcp-adapter is not installed; the local-pi MCP path requires >= $MCP_ADAPTER_FLOOR"
else
  echo "pi-mcp-adapter version: $ADAPTER_VERSION"
  # X2 — the boundary. Sort -V puts the lower version first; if the lowest of
  # the pair is the floor and they differ, the installed one is above it.
  LOWEST=$(printf '%s\n%s\n' "$ADAPTER_VERSION" "$MCP_ADAPTER_FLOOR" | sort -V | head -1)
  if [ "$LOWEST" != "$MCP_ADAPTER_FLOOR" ] && [ "$ADAPTER_VERSION" != "$MCP_ADAPTER_FLOOR" ]; then
    echo "NOTE: pi-mcp-adapter $ADAPTER_VERSION is below the $MCP_ADAPTER_FLOOR floor;"
    echo "      protocol 2026-07-28 would fall back to the legacy handshake."
    echo "      Upgrade with: pi ext update pi-mcp-adapter"
  else
    echo "pi-mcp-adapter satisfies the >= $MCP_ADAPTER_FLOOR floor"
  fi
fi

# --- mcp.json provisioning against the real filesystem (J7, J8) ------------
# The dashboard writes its own entry so a local pi session can reach /mcp.
# Asserted here rather than in a unit test because J7/J8 are about the REAL
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
  # J8 — first run, before any server start. Absence here is correct.
  echo "NOTE: $MCP_JSON absent (created on first server start)"
fi

echo "PASS: pi-dashboard installed successfully"
