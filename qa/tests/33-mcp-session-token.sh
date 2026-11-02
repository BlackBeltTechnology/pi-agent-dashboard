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
# - D2  The live /mcp surface never advertises the prompt-answer tools and
#       `tools/call prompt_response` is the unknown-tool error (change:
#       close-security-map-high-findings). Uses a device token minted over the
#       loopback operator road; a per-session token needs a live pi session, so that
#       cell is covered by the L1 dispatch tests. SKIPs when no token can be minted.

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

# ── D2 — the live /mcp surface has no prompt-answer tool ────────────────────
echo "--- D2: tools/list lacks prompt_response / extension_ui_response; tools/call is unknown-tool"
MINT_JSON=$(timeout 10 curl -s --max-time 5 -X POST "$BASE/api/paired-devices" \
  -H "content-type: application/json" \
  -d '{"label":"qa-33-d2","tier":"operate"}' 2>/dev/null || echo "")
D2_TOKEN=$(printf '%s' "$MINT_JSON" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const j=JSON.parse(s); process.stdout.write(String((j.data&&j.data.token)||"")); } catch { process.stdout.write(""); }
  });')
if [ -z "$D2_TOKEN" ]; then
  echo "SKIP: D2 could not mint a device token over loopback (operator auth required here)"
  exit 0
fi
MCP_V="2026-07-28"
mcp_call() {
  timeout 10 curl -s --max-time 5 -w '\n%{http_code}' -X POST "$BASE/mcp" \
    -H "Authorization: Bearer $D2_TOKEN" \
    -H "mcp-protocol-version: $MCP_V" \
    -H "content-type: application/json" -d "$1"
}
LIST_OUT=$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"'"$MCP_V"'"}}}')
LIST_CODE=$(printf '%s' "$LIST_OUT" | tail -n1)
LIST_BODY=$(printf '%s' "$LIST_OUT" | sed '$d')
if [ "$LIST_CODE" != "200" ]; then
  echo "FAIL: D2 tools/list answered $LIST_CODE (want 200)"
  exit 1
fi
if printf '%s' "$LIST_BODY" | grep -Eq '"name":"(prompt_response|extension_ui_response)"'; then
  echo "FAIL: D2 tools/list still advertises a prompt-answer tool"
  exit 1
fi
if ! printf '%s' "$LIST_BODY" | grep -q '"name":"list_sessions"'; then
  echo "FAIL: D2 tools/list lacks list_sessions (surface not actually listed)"
  exit 1
fi
CALL_OUT=$(mcp_call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"'"$MCP_V"'"},"name":"prompt_response","arguments":{"sessionId":"qa-none","promptId":"p","answer":"x"}}}')
CALL_CODE=$(printf '%s' "$CALL_OUT" | tail -n1)
CALL_BODY=$(printf '%s' "$CALL_OUT" | sed '$d')
if [ "$CALL_CODE" != "404" ] || ! printf '%s' "$CALL_BODY" | grep -q 'Unknown tool: prompt_response'; then
  echo "FAIL: D2 tools/call prompt_response answered $CALL_CODE / $CALL_BODY (want 404 Unknown tool)"
  exit 1
fi
echo "PASS: D2 /mcp lacks both answer tools; prompt_response is the unknown-tool error"
