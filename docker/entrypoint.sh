#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# pi-dashboard container entrypoint.
#
#   0. Resolve the credential data key file (PI_DASHBOARD_DATA_KEY_FILE) and,
#      on a fresh state, generate it under /home/pi/.pi-key (never in argv).
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

# 0. Credential data key file (change: encrypt-credentials-at-rest, design D6, G9).
#    The plugin-credential store and the vault are encrypted at rest; in a
#    container there is no OS keychain, so the key lives in a 0600 file on its
#    OWN volume (/home/pi/.pi-key), separate from the pi-state volume: a copy of
#    the state volume (backup, sync) then carries no key.
#      - PI_DASHBOARD_DATA_KEY_FILE unset  -> export the default path below.
#      - the key file is generated ONLY at that default path (a preset custom
#        path is the operator's: never generated, never overridden), ONLY when it
#        is absent AND neither credential file already holds an envelope (a fresh
#        key over an existing envelope would only turn `key_file_missing` into
#        `key_mismatch`). With an envelope present it refuses, prints the
#        restore remedy and starts the server anyway, which reports the files
#        locked.
#      - the key goes from /dev/urandom to the file by redirect under umask 077:
#        never in argv, an env var, or a log line.
# >>> credential-data-key
DEFAULT_DATA_KEY_DIR="/home/pi/.pi-key"
DEFAULT_DATA_KEY_FILE="${DEFAULT_DATA_KEY_DIR}/data-key"
if [ -z "${PI_DASHBOARD_DATA_KEY_FILE:-}" ]; then
  export PI_DASHBOARD_DATA_KEY_FILE="${DEFAULT_DATA_KEY_FILE}"
fi
if [ "${PI_DASHBOARD_DATA_KEY_FILE}" = "${DEFAULT_DATA_KEY_FILE}" ]; then
  # A dedicated mount keeps the key out of the state volume and out of the
  # container layer. The Dockerfile VOLUME only creates an ANONYMOUS volume
  # (`docker compose down -v` or a fresh `docker run` loses it); a Docker anonymous
  # volume's source is /volumes/<64 hex>/_data in mountinfo.
  if ! awk -v d="${DEFAULT_DATA_KEY_DIR}" '$5 == d { found = 1 } END { exit !found }' /proc/self/mountinfo 2>/dev/null; then
    echo "[entrypoint] WARNING: ${DEFAULT_DATA_KEY_DIR} is not a mounted volume: the data key will be lost with this container. Mount a named volume at ${DEFAULT_DATA_KEY_DIR} (see docker/README.md)."
  elif awk -v d="${DEFAULT_DATA_KEY_DIR}" '$5 == d { print $4 }' /proc/self/mountinfo 2>/dev/null | grep -Eq '/volumes/[0-9a-f]{64}/_data$'; then
    echo "[entrypoint] WARNING: ${DEFAULT_DATA_KEY_DIR} is an anonymous volume: docker compose down -v or a new docker run loses the data key. Mount a NAMED volume at ${DEFAULT_DATA_KEY_DIR} (see docker/README.md)."
  fi
  if [ ! -e "${DEFAULT_DATA_KEY_FILE}" ]; then
    has_envelope=0
    for cred_file in "${HOME:-/home/pi}/.pi/agent/plugin-credentials.json" "${HOME:-/home/pi}/.pi/dashboard/vault.json"; do
      if [ -f "${cred_file}" ] && head -c 23 "${cred_file}" 2>/dev/null | grep -q '^pi-dashboard-encrypted:'; then
        has_envelope=1
      fi
    done
    if [ "${has_envelope}" = "1" ]; then
      echo "[entrypoint] REFUSING to generate a data key: an encrypted credential file exists but ${DEFAULT_DATA_KEY_FILE} is missing. A new key could not decrypt it. Restore ${DEFAULT_DATA_KEY_FILE} (mode 0600) from your backup of the key volume; starting anyway, the files are reported locked (key_file_missing). See docker/README.md."
    elif ( umask 077 && mkdir -p "${DEFAULT_DATA_KEY_DIR}" && head -c 32 /dev/urandom | base64 > "${DEFAULT_DATA_KEY_FILE}" ) 2>/dev/null; then
      echo "[entrypoint] generated credential data key at ${DEFAULT_DATA_KEY_FILE} (mode 0600)"
    else
      echo "[entrypoint] could not create ${DEFAULT_DATA_KEY_FILE}; credential writes will be refused until a key file exists"
    fi
  fi
fi
# <<< credential-data-key

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

# `PI_ENTRYPOINT_NO_SUPERVISE=1` returns here instead of blocking, for a caller
# that wraps this script and supervises itself (`test-entrypoint.sh`).
if [ "${PI_ENTRYPOINT_NO_SUPERVISE:-}" = "1" ]; then
  echo "[entrypoint] exec pi-dashboard ${ARGS[*]}"
  exec pi-dashboard "${ARGS[@]}"
fi

# `start` spawns the server DETACHED and returns, so exec'ing it as PID 1 ends
# the container the moment the daemon is up. Launch, then supervise the pidfile
# for the daemon's lifetime. See docker/supervise-daemon.sh for why the daemon
# is not simply run in the foreground instead (`POST /api/restart`).
echo "[entrypoint] pi-dashboard ${ARGS[*]}"
pi-dashboard "${ARGS[@]}" || echo "[entrypoint] launcher exited non-zero (readiness timeout?); the daemon is detached — supervising"

# shellcheck source=docker/supervise-daemon.sh
. /usr/local/bin/supervise-daemon.sh
supervise_daemon "${HOME:-/home/pi}/.pi/dashboard/server.pid"
