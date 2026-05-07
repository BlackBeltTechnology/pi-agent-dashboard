#!/bin/bash
# Capture screenshots inside sandbox container and copy them out.
# Usage: sandbox/scripts/capture-screenshots.sh <scenario.json> <output-dir>
#
# Prerequisites: Docker with compose plugin.
# Starts sandbox, copies scenario in, runs it, copies screenshots out, tears down.

set -e

SCENARIO="${1:?Usage: $0 <scenario.json> <output-dir>}"
OUTDIR="${2:?Usage: $0 <scenario.json> <output-dir>}"
COMPOSE_FILE="sandbox/docker-compose.yml"

mkdir -p "$OUTDIR"

echo "[capture] Starting sandbox..."
docker compose -f "$COMPOSE_FILE" up -d --wait 2>&1

echo "[capture] Copying scenario into container..."
docker compose -f "$COMPOSE_FILE" cp "$SCENARIO" dashboard:/tmp/scenario.json

echo "[capture] Running scenarios inside container..."
docker compose -f "$COMPOSE_FILE" exec -T dashboard \
  bash sandbox/scripts/run-scenarios.sh /tmp/scenario.json /tmp/screenshots/ 2>&1

echo "[capture] Copying screenshots out..."
docker compose -f "$COMPOSE_FILE" cp dashboard:/tmp/screenshots/. "$OUTDIR/" 2>/dev/null || \
  docker compose -f "$COMPOSE_FILE" cp "dashboard:/tmp/screenshots/." "$OUTDIR/"

echo "[capture] Tearing down sandbox..."
docker compose -f "$COMPOSE_FILE" down 2>&1 || true

echo "[capture] Done. Screenshots in $OUTDIR/"
ls -la "$OUTDIR"/*.png 2>/dev/null || echo "WARNING: no screenshots found"
