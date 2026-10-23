#!/usr/bin/env bash
# Pi Dashboard API helper — wraps curl (or `pi-dashboard api` for a local target, which sends local proof)
# with port auto-detection and JSON formatting.
#
# This is the REST layer for READ-ONLY + no-WS-twin operations (session/health/
# config reads, git ops, grep/browse, plugin_config_write, tunnel, peer scan,
# openspec archive/toggle). Session/flow COMMAND verbs (abort, send_prompt,
# spawn, resume, flow_control, set_model/thinking, rename, hide/unhide,
# attach/detach_proposal) should use scripts/dashboard-bus.ts — the typed WS bus.
#
# Usage:
#   ./dashboard-api.sh METHOD PATH [JSON_BODY]
#
# Examples:
#   ./dashboard-api.sh GET /api/sessions
#   ./dashboard-api.sh GET /api/health
#   ./dashboard-api.sh POST /api/session/abc123/prompt '{"text":"hello"}'
#   ./dashboard-api.sh POST /api/session/spawn '{"cwd":"/path/to/project"}'
#   ./dashboard-api.sh PUT /api/config '{"autoShutdown":false}'
#
# Environment variables:
#   DASHBOARD_PORT   Override port (default: from config or 8000)
#   DASHBOARD_HOST   Override host (default: localhost)
#   DASHBOARD_TOKEN  JWT token for authenticated requests

set -euo pipefail

METHOD="${1:?Usage: dashboard-api.sh METHOD PATH [BODY]}"
PATH_ARG="${2:?Usage: dashboard-api.sh METHOD PATH [BODY]}"
BODY="${3:-}"

# ── Discover port ──────────────────────────────────────────────────

CONFIG_FILE="$HOME/.pi/dashboard/config.json"

if [ -n "${DASHBOARD_PORT:-}" ]; then
  PORT="$DASHBOARD_PORT"
elif [ -f "$CONFIG_FILE" ]; then
  PORT=$(grep '"port"' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*' || echo 8000)
else
  PORT=8000
fi

# The config file can hold several "port" keys (e.g. nested ones): the first match is the server port.
PORT="${PORT%%$'\n'*}"

HOST="${DASHBOARD_HOST:-localhost}"
BASE="http://$HOST:$PORT"

# ── Local callers: send local proof ────────────────────────────────
#
# The strict `requireLocalProof` default refuses a bare-loopback curl on every non-observe route.
# When the target is THIS host and no JWT is in play, delegate to `pi-dashboard api`, which mints a
# fresh local proof for the request. A remote HOST (or a JWT) keeps the plain curl path below.
# See change: close-container-loopback-impersonation (D5).
case "$HOST" in
  localhost|127.0.0.1|::1|"[::1]")
    if [ -z "${DASHBOARD_TOKEN:-}" ] && command -v pi-dashboard >/dev/null 2>&1; then
      API_ARGS=(api "$METHOD" "$PATH_ARG" --port "$PORT")
      case "$METHOD" in
        POST|PUT|PATCH)
          BODY_OUT="$BODY"
          [ -n "$BODY_OUT" ] || BODY_OUT='{}'
          API_ARGS+=(--data "$BODY_OUT")
          ;;
      esac
      if RESPONSE=$(pi-dashboard "${API_ARGS[@]}" 2>&1); then
        :
      else
        RC=$?
        # A non-2xx answer: show the server's body, then fail like curl -f would not (curl -s prints it and exits 0).
        if [ "$RC" = "2" ]; then
          echo "ERROR: Failed to reach dashboard at $BASE" >&2
          echo "Is the server running? Try: pi-dashboard status" >&2
          exit 1
        fi
      fi
      if command -v jq &>/dev/null; then echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"; else echo "$RESPONSE"; fi
      exit 0
    fi
    ;;
esac

# ── Build curl args ────────────────────────────────────────────────

CURL_ARGS=(-s -X "$METHOD")
CURL_ARGS+=("${BASE}${PATH_ARG}")

# Add Content-Type for methods with body
case "$METHOD" in
  POST|PUT|PATCH)
    CURL_ARGS+=(-H "Content-Type: application/json")
    if [ -n "$BODY" ]; then
      CURL_ARGS+=(-d "$BODY")
    else
      CURL_ARGS+=(-d "{}")
    fi
    ;;
esac

# Add auth token if available
if [ -n "${DASHBOARD_TOKEN:-}" ]; then
  CURL_ARGS+=(-b "pi_dash_token=$DASHBOARD_TOKEN")
fi

# ── Execute and format ─────────────────────────────────────────────

RESPONSE=$(curl "${CURL_ARGS[@]}" 2>&1) || {
  echo "ERROR: Failed to reach dashboard at $BASE" >&2
  echo "Is the server running? Try: pi-dashboard status" >&2
  exit 1
}

# Format with jq if available, otherwise output raw
if command -v jq &>/dev/null; then
  echo "$RESPONSE" | jq .
else
  echo "$RESPONSE"
fi
