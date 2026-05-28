#!/usr/bin/env bash
# Detect dashboard server URL, mode, and Vite dev server status.
#
# Usage:
#   bash detect-dashboard.sh
#
# Output (key=value):
#   DASHBOARD_URL=http://localhost:8000
#   MODE=dev
#   VITE_URL=http://localhost:5173
#
# Or if not running:
#   DASHBOARD=not-running

set -euo pipefail

# ── Read port from config ──────────────────────────────────────────

CONFIG_FILE="$HOME/.pi/dashboard/config.json"

if [ -f "$CONFIG_FILE" ]; then
  PORT=$(grep '"port"' "$CONFIG_FILE" 2>/dev/null | grep -o '[0-9]*' || echo 8000)
else
  PORT=8000
fi

BASE="http://localhost:$PORT"

# ── Probe dashboard health ─────────────────────────────────────────

HEALTH=$(curl -s --connect-timeout 2 --max-time 3 "$BASE/api/health" 2>/dev/null || echo "")

if [ -z "$HEALTH" ]; then
  echo "DASHBOARD=not-running"
  echo "PORT=$PORT"
  exit 0
fi

echo "DASHBOARD_URL=$BASE"

# ── Extract mode ───────────────────────────────────────────────────

MODE=$(echo "$HEALTH" | grep -o '"mode":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
echo "MODE=$MODE"

# ── Probe Vite dev server ─────────────────────────────────────────

VITE_PORT=5173
VITE_PROBE=$(curl -s --connect-timeout 1 --max-time 2 "http://localhost:$VITE_PORT" 2>/dev/null || echo "")

if [ -n "$VITE_PROBE" ]; then
  echo "VITE_URL=http://localhost:$VITE_PORT"
else
  echo "VITE=not-running"
fi
