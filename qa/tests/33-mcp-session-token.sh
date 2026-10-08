#!/usr/bin/env bash
# Test: per-session MCP credential delivery via pi's built-in MCP registration
# (change: migrate-mcp-to-pi-builtin; earlier: wire-mcp-session-token).
#
# The bridge now registers `pi-dashboard` with `pi.registerMcpServer()` using the
# token + `/mcp` URL the server delivers; nothing is written to mcp.json and the
# token never enters the pi process env. Three legs:
#
# - M1  No provisioning artefacts ship: the installed mcp-server plugin carries
#       no `header-command.mjs` and no source references `PI_DASHBOARD_MCP_TOKEN`.
# - M2  The running server leaves no provisioned `pi-dashboard` entry in the
#       Pi-global mcp.json (the startup migration removes an old one).
# - X8  Degradation is clean: an unminted bearer gets an immediate 401 from the
#       live server and the loopback source is not locked out.

set -euo pipefail

echo "=== Test: MCP session token delivery (built-in MCP registration) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

BASE="${PI_QA_BASE:-http://localhost:8000}"
PLUGIN_DIR="${PI_DASHBOARD_PLUGIN_DIR:-}"

find_plugin_dir() {
  if [ -n "$PLUGIN_DIR" ] && [ -d "$PLUGIN_DIR/src/server" ]; then
    echo "$PLUGIN_DIR"
    return 0
  fi
  for d in \
    "$HOME/.pi/dashboard/node_modules/@blackbelt-technology/pi-dashboard-mcp-server-plugin" \
    "$HOME/.nvm/versions/node"/*/lib/node_modules/@blackbelt-technology/pi-agent-dashboard/node_modules/@blackbelt-technology/pi-dashboard-mcp-server-plugin \
    "$(pwd)/packages/mcp-server-plugin"; do
    if [ -d "$d/src/server" ]; then
      echo "$d"
      return 0
    fi
  done
  return 1
}

# ── M1 — no provisioning artefacts ship ────────────────────────────────────
echo "--- M1: installed mcp-server plugin carries no header command"
if DIR="$(find_plugin_dir)"; then
  if [ -e "$DIR/src/server/header-command.mjs" ]; then
    echo "FAIL: $DIR/src/server/header-command.mjs still ships"
    exit 1
  fi
  if grep -rq 'PI_DASHBOARD_MCP_TOKEN' "$DIR/src/server" --include='*.ts' --include='*.mjs' 2>/dev/null; then
    echo "FAIL: $DIR/src/server still references PI_DASHBOARD_MCP_TOKEN"
    exit 1
  fi
  echo "PASS: M1 no header command, no token env var in $DIR"
else
  echo "SKIP: M1 mcp-server plugin not installed here"
fi

# ── M2 — no provisioned pi-dashboard entry in the Pi-global mcp.json ───────
echo "--- M2: Pi-global mcp.json holds no provisioned pi-dashboard entry"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
MCP_JSON="$AGENT_DIR/mcp.json"
if [ -f "$MCP_JSON" ]; then
  if node -e '
    const raw = require("fs").readFileSync(process.argv[1], "utf8");
    let cfg; try { cfg = JSON.parse(raw); } catch { process.exit(0); }
    const e = cfg && cfg.mcpServers && cfg.mcpServers["pi-dashboard"];
    const rhc = e && e.requestHeadersCommand;
    const provisioned = rhc && rhc.command === "node" && Array.isArray(rhc.args) && /header-command\.mjs$/.test(String(rhc.args[0]));
    process.exit(provisioned ? 1 : 0);
  ' "$MCP_JSON"; then
    echo "PASS: M2 $MCP_JSON has no provisioned pi-dashboard entry"
  else
    echo "FAIL: $MCP_JSON still holds the provisioned pi-dashboard entry (startup migration did not run)"
    exit 1
  fi
else
  echo "PASS: M2 $MCP_JSON absent (nothing provisioned)"
fi

# ── X8 — degradation is clean against the live server ──────────────────────
echo "--- X8: unminted bearer gets a clean 401"
HTTP_CODE=$(timeout 10 curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$BASE/mcp" \
  -H "Authorization: Bearer mcp_definitely-unminted" \
  -H "mcp-protocol-version: 2025-11-25" \
  -H "content-type: application/json" -d '{}' 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "000" ]; then
  echo "SKIP: X8 dashboard not reachable at $BASE"
  exit 0
fi
if [ "$HTTP_CODE" != "401" ]; then
  echo "FAIL: live server answered $HTTP_CODE for an unminted bearer (want 401)"
  exit 1
fi
echo "PASS: X8 clean 401 for an unminted bearer (loopback not locked out)"
