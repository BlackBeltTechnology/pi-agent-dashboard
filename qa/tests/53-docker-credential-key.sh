#!/usr/bin/env bash
# Test: the Docker credential data key (design D6, decision G9).
#
# Runs the DOCUMENTED `docker compose up -d` (no test entrypoint, no root, fresh
# volumes) and asserts, in order:
#   E80  fresh `pi-state` + `pi-key`: /home/pi/.pi-key/data-key is `600 pi`, and a vault
#        account POSTed through the API leaves vault.json an encrypted envelope.
#   X18  the key content appears in no log, no /proc/<pid>/environ and no /proc/<pid>/cmdline
#        (the PATH of the key file may); a pi session is spawned first so its env is covered.
#   E81  lost key volume (`pi-state` kept, `pi-key` recreated empty): no key is generated,
#        vault `locked` / `key_file_missing`, the entrypoint log carries the restore remedy.
#   E82  `docker run` without a /home/pi/.pi-key mount: the log names /home/pi/.pi-key,
#        /api/health answers 200.
#   E83  preset custom `PI_DASHBOARD_DATA_KEY_FILE=/run/k/key` (missing) over the encrypted
#        vault: env not overridden (server log `source=key-file`), nothing created at
#        /run/k/key nor at the default path, vault locked `key_file_missing`.
#   E85  every compose overlay merged on top of compose.yml + compose.test.yml still mounts
#        /home/pi/.pi-key into `pi-dashboard`.
#
# Slow (an image build, several container starts) and needs docker: OPT-IN, not in
# run-all.sh. `PI_QA_DOCKER=1` to run it. Needs the image built from THIS tree.
#
# See change: encrypt-credentials-at-rest (tasks 11.2; test-plan E80-E83, E85, X18).
set -euo pipefail

echo "=== Test: docker credential data key ==="

if [ "${PI_QA_DOCKER:-}" != "1" ]; then
  echo "SKIP: opt-in (PI_QA_DOCKER=1) — builds an image and starts several containers"; exit 0
fi
command -v docker >/dev/null 2>&1 || { echo "SKIP: docker not on PATH"; exit 0; }
docker info >/dev/null 2>&1 || { echo "SKIP: docker daemon not reachable"; exit 0; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="qa-credkey-$$"
PORT="${PI_QA_DOCKER_PORT:-18891}"
GATEWAY="${PI_QA_DOCKER_GATEWAY_PORT:-19891}"
KEY_FILE=/home/pi/.pi-key/data-key
EXTRA=()

compose() { ( cd "$REPO_ROOT/docker" && DASHBOARD_PORT="$PORT" PI_GATEWAY_PORT="$GATEWAY" TUNNEL_ENABLED=0 docker compose -p "$PROJECT" "$@" ); }
fail() { echo "FAIL: $*"; exit 1; }

cleanup() {
  compose down -v >/dev/null 2>&1 || true
  for c in "${EXTRA[@]:-}"; do [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true; done
  for v in "${EXTRA_VOLUMES[@]:-}"; do [ -n "$v" ] && docker volume rm -f "$v" >/dev/null 2>&1 || true; done
}
EXTRA_VOLUMES=()
trap cleanup EXIT

wait_health() { # <host port> [seconds]
  local port="$1" tries=$(( ${2:-180} / 3 ))
  for _ in $(seq 1 "$tries"); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$port/api/health" 2>/dev/null)" = "200" ] && return 0
    sleep 3
  done
  return 1
}

container() { compose ps -q pi-dashboard | head -1; }
# Vault status as the API reports it (loopback inside the container; `pi-dashboard api` mints local proof).
vault_status() { docker exec "$1" pi-dashboard api GET /api/vault --port "${2:-$PORT}" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);const x=(v.data||v).status||{};console.log((x.state||x.kind||"?")+" "+(x.reason||""))})'; }

cd "$REPO_ROOT/docker"
[ -f .env ] || cp .env.example .env
echo "--- building the image (the deployment path)"
compose -f compose.yml build > /tmp/qa-credkey-build.log 2>&1 || { tail -20 /tmp/qa-credkey-build.log; fail "image build failed"; }
compose down -v >/dev/null 2>&1 || true

# ── E80: fresh volumes ────────────────────────────────────────────────────
echo "--- E80: fresh pi-state + pi-key"
compose up -d > /tmp/qa-credkey-up.log 2>&1 || { cat /tmp/qa-credkey-up.log; fail "compose up failed"; }
C="$(container)"; [ -n "$C" ] || fail "no container was created"
wait_health "$PORT" || { compose logs 2>&1 | tail -30; fail "the dashboard never answered on port $PORT"; }

STAT="$(docker exec "$C" stat -c '%a %U' "$KEY_FILE" 2>&1 || true)"
[ "$STAT" = "600 pi" ] || fail "E80: $KEY_FILE is '$STAT', expected '600 pi'"
docker exec "$C" pi-dashboard api POST /api/vault/accounts --port "$PORT" \
  --data '{"provider":"qa","label":"qa-credkey","value":"qa-secret-value-80"}' >/dev/null || fail "E80: POST /api/vault/accounts failed"
HEAD="$(docker exec "$C" head -1 /home/pi/.pi/dashboard/vault.json 2>&1 || true)"
[ "$HEAD" = "pi-dashboard-encrypted:v1" ] || fail "E80: vault.json first line is '$HEAD', expected 'pi-dashboard-encrypted:v1'"
docker exec "$C" grep -q qa-secret-value-80 /home/pi/.pi/dashboard/vault.json 2>/dev/null && fail "E80: the vault value is readable in vault.json"
echo "    key $STAT; vault.json is an envelope"

# ── X18: the key never leaks ──────────────────────────────────────────────
echo "--- X18: key content in logs / environ / cmdline"
docker exec "$C" curl -s -X POST -H 'content-type: application/json' --max-time 20 \
  -d '{"cwd":"/home/pi"}' "http://localhost:$PORT/api/session/spawn" >/dev/null 2>&1 || true
sleep 10 # a spawned pi has time to exist; the scan below covers every process either way
KEY_CONTENT="$(docker exec "$C" sh -c "tr -d '\\n' < $KEY_FILE")"
[ "${#KEY_CONTENT}" -ge 40 ] || fail "X18: could not read the key to scan for it"
# The key reaches the scanner through stdin and a 0600 temp file (`grep -f`), never an argv.
LEAKS="$(docker exec -i "$C" sh -c '
  umask 077; kf=$(mktemp); cat > "$kf"; n=0
  for p in /proc/[0-9]*; do
    for f in environ cmdline; do tr "\0" "\n" < "$p/$f" 2>/dev/null | grep -qFf "$kf" && { echo "$p/$f"; n=$((n+1)); }
  done; done; rm -f "$kf"; exit 0' <<<"$KEY_CONTENT")"
[ -z "$LEAKS" ] || fail "X18: the key content is in: $LEAKS"
if { docker logs "$C" 2>&1; docker exec "$C" sh -c 'cat /home/pi/.pi/dashboard/*.log 2>/dev/null'; } | grep -qFf <(printf %s "$KEY_CONTENT"); then
  fail "X18: the key content is in a log"
fi
echo "    no leak in $(docker exec "$C" sh -c 'ls -d /proc/[0-9]* | wc -l') processes or the logs"
IMAGE="$(docker inspect "$C" --format '{{.Image}}')"

# ── E81: lost key volume ──────────────────────────────────────────────────
echo "--- E81: pi-state kept, pi-key recreated empty"
compose down >/dev/null 2>&1
docker volume rm "${PROJECT}_pi-key" >/dev/null || fail "E81: could not drop the pi-key volume"
compose up -d > /tmp/qa-credkey-up.log 2>&1 || { cat /tmp/qa-credkey-up.log; fail "E81: compose up failed"; }
C="$(container)"
wait_health "$PORT" || fail "E81: the dashboard never answered"
docker exec "$C" test -e "$KEY_FILE" && fail "E81: a key was generated over an existing envelope"
compose logs 2>&1 | grep -q 'REFUSING to generate a data key' || fail "E81: the entrypoint log has no restore remedy"
ST="$(vault_status "$C")"
[ "$ST" = "locked key_file_missing" ] || fail "E81: vault status is '$ST', expected 'locked key_file_missing'"
echo "    refused to generate; vault $ST"

# ── E85: overlays keep the pi-key mount ───────────────────────────────────
echo "--- E85: overlays inherit the pi-key mount"
for overlay in compose.test.acme.yml compose.test.cap.yml compose.test.identity.yml; do
  OUT="$(cd "$REPO_ROOT/docker" && HOST_CWD=/tmp docker compose -f compose.yml -f compose.test.yml -f "$overlay" config --format json 2>/tmp/qa-credkey-config.log)" \
    || { cat /tmp/qa-credkey-config.log; fail "E85: docker compose config failed for $overlay"; }
  echo "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=(JSON.parse(s).services["pi-dashboard"].volumes||[]).map(x=>x.target);process.exit(v.includes("/home/pi/.pi-key")?0:1)})' \
    || fail "E85: $overlay drops the /home/pi/.pi-key mount"
done
echo "    acme, cap, identity keep the mount"

# ── E83: preset custom path (decision G9) ─────────────────────────────────
echo "--- E83: preset PI_DASHBOARD_DATA_KEY_FILE over the encrypted vault"
compose down >/dev/null 2>&1
P83=$((PORT + 3)); G83=$((GATEWAY + 3))
N83="${PROJECT}-e83"; EXTRA+=("$N83")
docker run -d --name "$N83" -v "${PROJECT}_pi-state:/home/pi/.pi" -e PI_DASHBOARD_DATA_KEY_FILE=/run/k/key \
  -e DASHBOARD_PORT="$P83" -e PI_GATEWAY_PORT="$G83" -e TUNNEL_ENABLED=0 -p "$P83:$P83" "$IMAGE" >/dev/null
wait_health "$P83" || { docker logs "$N83" 2>&1 | tail -20; fail "E83: the dashboard never answered"; }
docker exec "$N83" test -e /run/k/key && fail "E83: a key file appeared at the preset path"
docker exec "$N83" test -e "$KEY_FILE" && fail "E83: a key file appeared at the default path"
docker exec "$N83" sh -c 'grep -h "credential-key" /home/pi/.pi/dashboard/*.log' 2>/dev/null | grep -q 'source=key-file' || fail "E83: the server log does not show source=key-file"
ST="$(vault_status "$N83" "$P83")"
[ "$ST" = "locked key_file_missing" ] || fail "E83: vault status is '$ST', expected 'locked key_file_missing'"
docker rm -f "$N83" >/dev/null
echo "    env kept, nothing created, vault $ST"

# ── E82: no key mount at all ──────────────────────────────────────────────
echo "--- E82: docker run without a /home/pi/.pi-key mount"
P82=$((PORT + 2)); G82=$((GATEWAY + 2))
N82="${PROJECT}-e82"; EXTRA+=("$N82")
docker run -d --name "$N82" -e DASHBOARD_PORT="$P82" -e PI_GATEWAY_PORT="$G82" -e TUNNEL_ENABLED=0 -p "$P82:$P82" "$IMAGE" >/dev/null
wait_health "$P82" || { docker logs "$N82" 2>&1 | tail -20; fail "E82: /api/health did not answer 200"; }
docker logs "$N82" 2>&1 | grep -q '/home/pi/.pi-key' || fail "E82: the log never names /home/pi/.pi-key"
docker logs "$N82" 2>&1 | grep -q 'WARNING' || echo "    note: no WARNING line (volume not recognised as anonymous on this Docker); the log still names /home/pi/.pi-key"
docker rm -f "$N82" >/dev/null
echo "    health 200; log names /home/pi/.pi-key"

echo "PASS: the Docker credential data key is generated 0600 on its own volume, never leaks, is never regenerated over an envelope, and respects a preset path"
