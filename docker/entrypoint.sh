#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# pi-dashboard container entrypoint.
#
#   1. Seed ~/.pi/agent/auth.json from *_API_KEY env vars (first run only).
#   2. Seed spawn strategy into config.json (first run only).
#   3. Start a tmux server (for the tmux spawn strategy).
#   4. exec pi-dashboard with env-driven port/tunnel flags.
#
# Port mappings (compose env -> pi-dashboard flag):
#   DASHBOARD_PORT    -> --port
#   PI_GATEWAY_PORT   -> --pi-port
#   TUNNEL_ENABLED=0  -> --no-tunnel
# See openspec change docker-packaging.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_AUTH="${SCRIPT_DIR}/../docker/scripts/seed-auth.js"
# When installed to /usr/local/bin the script dir differs; fall back to /app.
[ -f "${SEED_AUTH}" ] || SEED_AUTH="/app/docker/scripts/seed-auth.js"

# 1. Seed auth.json (no-op if it already exists in the pi-state volume).
node "${SEED_AUTH}"

# 2. Seed spawn strategy on first run only. loadConfig() deep-merges partials,
#    so a single-key file is safe. Never overwrites an existing config.
CONFIG_FILE="${HOME}/.pi/dashboard/config.json"
if [ -n "${PI_SPAWN_STRATEGY:-}" ] && [ ! -f "${CONFIG_FILE}" ]; then
  mkdir -p "$(dirname "${CONFIG_FILE}")"
  # Build JSON with jq so a malformed strategy value can't break config parsing.
  jq -n --arg s "${PI_SPAWN_STRATEGY}" '{spawnStrategy: $s}' > "${CONFIG_FILE}"
  echo "[entrypoint] seeded spawnStrategy=${PI_SPAWN_STRATEGY} into ${CONFIG_FILE}"
fi

# 3. Start a detached tmux server so the tmux spawn strategy has a host.
tmux start-server 2>/dev/null || true

# 3.5 zrok v2 headless enrollment. `zrok2 enable <token>` without --headless
#     dies on `open /dev/tty: device not configured` in a non-interactive
#     container. Enroll only when not already enrolled (idempotent across
#     restarts on the ~/.zrok2 volume). See change: support-zrok-v2.
if [ -n "${ZROK_TOKEN:-}" ]; then
  ZROK_ENV="${HOME}/.zrok2/environment.json"
  # Validate the SAME required fields as readZrokEnvironment() — a malformed or
  # partial environment.json must not permanently suppress enrollment.
  if jq -e '
    (.api_endpoint | type == "string" and length > 0) and
    (.ziti_identity | type == "string" and length > 0) and
    (.zrok_token | type == "string" and length > 0)
  ' "${ZROK_ENV}" >/dev/null 2>&1; then
    echo "[entrypoint] zrok already enrolled (~/.zrok2/environment.json valid) — skipping enable"
  else
    [ ! -f "${ZROK_ENV}" ] || mv "${ZROK_ENV}" "${ZROK_ENV}.invalid"
    echo "[entrypoint] enrolling zrok v2 (headless)"
    zrok2 enable "${ZROK_TOKEN}" --headless || echo "[entrypoint] zrok enable failed — tunnel will be unavailable"
  fi
else
  echo "[entrypoint] ZROK_TOKEN unset — skipping zrok enrollment (tunnel disabled unless enrolled)"
fi

# 4. Build pi-dashboard flags from env.
ARGS=("${@:-start}")
[ -n "${DASHBOARD_PORT:-}" ]  && ARGS+=("--port" "${DASHBOARD_PORT}")
[ -n "${PI_GATEWAY_PORT:-}" ] && ARGS+=("--pi-port" "${PI_GATEWAY_PORT}")
case "${TUNNEL_ENABLED:-}" in
  0|false|no|off) ARGS+=("--no-tunnel") ;;
esac

echo "[entrypoint] exec pi-dashboard ${ARGS[*]}"
exec pi-dashboard "${ARGS[@]}"
