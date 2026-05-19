#!/usr/bin/env bash
# scripts/test-standalone-npm-install-docker.sh
#
# Verify locally-packed workspace tarballs install + boot cleanly on a
# clean Linux base image. Mirrors what CI runs (.github/workflows/ci.yml ::
# standalone-install-smoke-linux) but operates against THIS branch's HEAD
# rather than the published npm registry.
#
# Reproduces and confirms the fix for:
#   - 7.1 node-pty linux-x64 prebuild gap
#   - 7.2 jiti not declared as runtime dep
#   - 7.3 JITI_PACKAGES resolver list drift
#
# Workflow:
#   1. npm pack every workspace into /tmp/pi-dashboard-packs-<ts>/
#   2. Spin a docker container against the requested base image
#   3. npm install -g <root-tarball>  (NO --ignore-scripts)
#   4. pi-dashboard --version           → must print version
#   5. pi-dashboard start               → background daemon
#   6. poll http://localhost:18000/api/health until bootstrap=ready (≤120s)
#   7. GET http://localhost:18000/      → must be HTTP 200 non-empty
#   8. cleanup
#
# Usage:
#   ./scripts/test-standalone-npm-install-docker.sh                    # node:22-bookworm-slim (default)
#   ./scripts/test-standalone-npm-install-docker.sh node:22-alpine
#   ./scripts/test-standalone-npm-install-docker.sh node:24-bookworm-slim
#   ./scripts/test-standalone-npm-install-docker.sh --keep             # keep container + packs on exit
#
# Exit codes:
#   0  all checks passed
#   1  install or boot failed
#   2  invalid args / docker unavailable

set -euo pipefail

IMAGE="node:22-bookworm-slim"
KEEP=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    -*) echo "unknown arg: $1" >&2; exit 2 ;;
    *) IMAGE="$1"; shift ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found on PATH" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TS=$(date +%Y%m%d-%H%M%S)
PACK_DIR="/tmp/pi-dashboard-packs-$TS"
CONTAINER_NAME="pi-dashboard-smoke-$TS"
mkdir -p "$PACK_DIR"

echo "[smoke] image:      $IMAGE"
echo "[smoke] packs dir:  $PACK_DIR"
echo "[smoke] container:  $CONTAINER_NAME"

cleanup() {
  if [[ "$KEEP" -eq 1 ]]; then
    echo "[smoke] --keep: leaving container '$CONTAINER_NAME' and packs '$PACK_DIR'"
    return
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$PACK_DIR"
}
trap cleanup EXIT

echo "[smoke] step 1/8: building web client"
( cd packages/client && npm run build >/dev/null )

echo "[smoke] step 2/8: pack workspaces individually (npm pack -ws is broken on npm@11.11.0 with ERR_OUT_OF_RANGE)"
# Discover non-private publishable workspaces from packages/.
# Then pack each + the root. Filter out `private: true`.
PACKAGES_TO_PACK=()
while IFS= read -r -d '' pkg; do
  # require() needs `./` prefix to resolve as a relative path; bare
  # `packages/foo/package.json` would try a node_modules lookup.
  IS_PRIVATE=$(node -p "require('./$pkg').private === true" 2>/dev/null || echo "false")
  if [[ "$IS_PRIVATE" != "true" ]]; then
    PACKAGES_TO_PACK+=("$(dirname "$pkg")")
  fi
done < <(find packages -maxdepth 2 -name package.json -print0)

echo "[smoke]   packing ${#PACKAGES_TO_PACK[@]} workspaces + root"
for wsdir in "${PACKAGES_TO_PACK[@]}"; do
  npm pack --workspace="$wsdir" --pack-destination "$PACK_DIR" --silent >/dev/null
done
# Root tarball last.
npm pack --pack-destination "$PACK_DIR" --silent >/dev/null

echo "[smoke]   packs ($(ls "$PACK_DIR"/*.tgz | wc -l | tr -d ' ')):"
ls -1 "$PACK_DIR"/*.tgz | sed 's|.*/|    |'

# Identify the root tarball (the one that satisfies `npm i -g`).
ROOT_TGZ=$(ls "$PACK_DIR"/blackbelt-technology-pi-agent-dashboard-*.tgz 2>/dev/null | head -1)
if [[ -z "$ROOT_TGZ" ]]; then
  echo "[smoke] FAIL: root tarball not found in $PACK_DIR" >&2
  exit 1
fi
echo "[smoke]   root tarball: $(basename "$ROOT_TGZ")"

echo "[smoke] step 3/8: launching container"
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 18000:18000 \
  -v "$PACK_DIR":/packs:ro \
  -e DEBIAN_FRONTEND=noninteractive \
  "$IMAGE" \
  sleep 600 >/dev/null

# Helper: run a command inside the container, stream output, return exit code.
indocker() {
  docker exec "$CONTAINER_NAME" bash -c "$1"
}

echo "[smoke] step 4/8: installing system tools inside container (curl + bash)"
if [[ "$IMAGE" == *"alpine"* ]]; then
  indocker "apk add --no-cache curl bash >/dev/null" || true
else
  indocker "apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends curl ca-certificates procps >/dev/null"
fi

echo "[smoke] step 5/8: npm install all local tarballs at once (NO --ignore-scripts)"
# Critical: this step exercises 7.1 (node-pty postinstall) and 7.2 (jiti dep).
#
# Why all-tarballs-at-once: `npm install <root.tgz>` resolves the root's
# workspace deps (e.g. @blackbelt-technology/pi-dashboard-server@^0.5.3) via
# the public npm registry because dep ranges are semver, not file: URIs.
# That would fetch the PUBLISHED versions of the workspaces, not our locally
# packed ones. Passing every tarball as a file: argument to a SINGLE
# `npm install` call makes npm prefer the file: resolutions over registry
# semver lookups for matching name@version pairs.
#
# `--engine-strict=false` tolerates node-pty's prereleased engines.node range.
# Run via a project-local install (mkdir /test ; cd ; npm init ; npm install)
# so the bin is at /test/node_modules/.bin/pi-dashboard. Global install would
# also work but project-local is closer to library-author UX.
INSTALL_LOG=$(mktemp)
INSTALL_CMD='cd /test && for t in /packs/*.tgz; do ARGS="$ARGS $t"; done && npm install --engine-strict=false $ARGS'
if ! indocker "mkdir -p /test && (cd /test && npm init -y >/dev/null) && $INSTALL_CMD" >"$INSTALL_LOG" 2>&1; then
  echo "[smoke] FAIL: install rejected (exit non-zero)" >&2
  cat "$INSTALL_LOG" >&2
  rm -f "$INSTALL_LOG"
  exit 1
fi
# Reject install logs containing node-gyp/Python errors even if exit-0 (some
# postinstalls swallow errors but still emit them to stderr).
if grep -qE "(gyp ERR|node-gyp.*rebuild|Could not find any Python)" "$INSTALL_LOG"; then
  echo "[smoke] FAIL: install completed but emitted node-gyp/Python errors (task 7.1 regression)" >&2
  grep -E "(gyp ERR|node-gyp|Python)" "$INSTALL_LOG" | head -20 >&2
  rm -f "$INSTALL_LOG"
  exit 1
fi
rm -f "$INSTALL_LOG"
echo "[smoke]   install OK"

echo "[smoke] step 6/8: pi-dashboard --version"
VERSION_OUT=$(indocker "/test/node_modules/.bin/pi-dashboard --version" 2>&1 || true)
if [[ -z "$VERSION_OUT" ]] || echo "$VERSION_OUT" | grep -qi "cannot find jiti"; then
  echo "[smoke] FAIL: --version did not print a version (task 7.2 regression?)" >&2
  echo "  output: $VERSION_OUT" >&2
  exit 1
fi
echo "[smoke]   version: $VERSION_OUT"

echo "[smoke] step 7/8: pi-dashboard start, poll /api/health"
indocker "PI_DASHBOARD_PORT=18000 /test/node_modules/.bin/pi-dashboard start" >/dev/null 2>&1 || {
  echo "[smoke] FAIL: pi-dashboard start exited non-zero" >&2
  indocker "tail -100 ~/.pi/dashboard/server.log 2>/dev/null || true" >&2
  exit 1
}

# Poll for up to 180s. State transitions: installing → ready (or failed).
#
# Endpoint is /api/bootstrap/status (NOT /api/health.bootstrap — health only
# exposes installable counts, not the bootstrap status enum).
#
# Curl from INSIDE the container, not from the host: the dashboard's
# localhost-guard returns 403 "Access denied" to non-loopback requests,
# and `docker run -p 18000:18000` makes the source appear foreign from
# the host's perspective. From inside the container, localhost is
# loopback, so the guard accepts the request.
indocker "command -v curl >/dev/null || (apt-get install -y -qq curl >/dev/null 2>&1 || apk add --no-cache curl >/dev/null 2>&1)"
DEADLINE=$((SECONDS + 180))
LAST_STATE=""
SUCCESS=0
while [[ $SECONDS -lt $DEADLINE ]]; do
  RESP=$(indocker 'curl -fsS --max-time 3 http://localhost:18000/api/bootstrap/status 2>/dev/null' 2>/dev/null) || RESP=""
  if [[ -n "$RESP" ]]; then
    STATE=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).status||'unknown')}catch{console.log('parse-error')}})" 2>/dev/null || echo "unknown")
    if [[ "$STATE" != "$LAST_STATE" ]]; then
      echo "[smoke]   bootstrap status = $STATE"
      LAST_STATE="$STATE"
    fi
    if [[ "$STATE" == "ready" ]]; then SUCCESS=1; break; fi
    if [[ "$STATE" == "failed" ]]; then
      echo "[smoke] FAIL: bootstrap failed" >&2
      indocker "tail -100 ~/.pi/dashboard/server.log" >&2
      exit 1
    fi
  fi
  sleep 2
done

if [[ "$SUCCESS" -ne 1 ]]; then
  echo "[smoke] FAIL: bootstrap did not reach ready within 180s (last: $LAST_STATE)" >&2
  indocker "tail -100 ~/.pi/dashboard/server.log" >&2
  exit 1
fi

echo "[smoke] step 8/10: GET / returns HTTP 200 non-empty"
# Again: curl from INSIDE the container to satisfy localhost-guard.
GET_OUT=$(indocker 'curl -s -o /tmp/idx.html -w "%{http_code} %{size_download}" http://localhost:18000/' 2>/dev/null || echo "000 0")
HTTP_CODE=$(echo "$GET_OUT" | awk '{print $1}')
BODY_SIZE=$(echo "$GET_OUT" | awk '{print $2}')
if [[ "$HTTP_CODE" != "200" || "$BODY_SIZE" -lt 100 ]]; then
  echo "[smoke] FAIL: GET / returned $HTTP_CODE size=$BODY_SIZE" >&2
  exit 1
fi
echo "[smoke]   HTTP 200, body size $BODY_SIZE bytes"

echo "[smoke] step 9/10: spawn a pi session and confirm it registers"
# Copy the spawn helper into the container, run it from inside so the
# WS connection originates from loopback (localhost-guard accepts it).
# Session cwd: /tmp/smoke-cwd (created here, pre-existing dirs are also
# fine — pi just needs an existing directory to root the session).
docker cp "$REPO_ROOT/scripts/lib/smoke-spawn-session.mjs" "$CONTAINER_NAME":/smoke-spawn-session.mjs
SESSION_OUT=$(mktemp)
if indocker 'mkdir -p /tmp/smoke-cwd && node /smoke-spawn-session.mjs --url ws://localhost:18000/ws --cwd /tmp/smoke-cwd --timeout 90' >"$SESSION_OUT" 2>&1; then
  # Re-emit the spawn helper's [spawn] lines under our [smoke] prefix.
  while IFS= read -r line; do
    [[ "$line" == \[spawn\]* ]] && echo "[smoke]   ${line}"
  done <"$SESSION_OUT"
  rm -f "$SESSION_OUT"
else
  echo "[smoke] FAIL: spawn helper exited non-zero" >&2
  cat "$SESSION_OUT" >&2
  rm -f "$SESSION_OUT"
  indocker "tail -60 ~/.pi/dashboard/server.log" >&2 || true
  exit 1
fi

# Confirm the session also appears in /api/sessions REST output.
# Response shape: {success:true, data:[{id, cwd, ...}, ...]}.
SESS_COUNT=$(indocker 'curl -fsS http://localhost:18000/api/sessions 2>/dev/null | node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{try{const r=JSON.parse(d);const arr=Array.isArray(r)?r:(r.data||[]);console.log(arr.filter(s=>s.cwd===\"/tmp/smoke-cwd\").length)}catch{console.log(0)}})"' 2>/dev/null || echo 0)
if [[ "$SESS_COUNT" -lt 1 ]]; then
  echo "[smoke] FAIL: spawned session not visible in /api/sessions (count=$SESS_COUNT)" >&2
  exit 1
fi
echo "[smoke]   /api/sessions confirms $SESS_COUNT session at /tmp/smoke-cwd"

echo "[smoke] step 10/10: openspec CLI + /api/openspec-archive end-to-end"
# Two assertions:
#   (a) The bundled `openspec` CLI is invokable from the installed tree.
#       Under the npm-i path, the bin lives at
#       /test/node_modules/.bin/openspec (symlinked into the install tree by
#       `npm install` of @fission-ai/openspec).
#   (b) The dashboard's /api/openspec-archive endpoint correctly scans a
#       <cwd>/openspec/changes/archive/ tree and returns its entries.
#       Pre-populate a minimal archive structure under /tmp/smoke-cwd
#       (the same cwd we spawned a session into in step 9), hit the
#       endpoint from inside the container, and assert the seeded entry
#       appears in the response.

# (a) openspec CLI ─────────────────────────────────────────────────────────
OPENSPEC_VERSION=$(indocker '/test/node_modules/.bin/openspec --version' 2>&1 || true)
if [[ -z "$OPENSPEC_VERSION" ]] || echo "$OPENSPEC_VERSION" | grep -qiE 'error|not found|cannot find'; then
  echo "[smoke] FAIL: openspec CLI not invokable" >&2
  echo "  output: $OPENSPEC_VERSION" >&2
  exit 1
fi
echo "[smoke]   openspec --version: $OPENSPEC_VERSION"

# (b) /api/openspec-archive ────────────────────────────────────────────────
# Seed a minimal archive entry. Directory name MUST start YYYY-MM-DD- to
# match DATE_PREFIX_RE in packages/server/src/openspec-archive.ts.
indocker '
  mkdir -p /tmp/smoke-cwd/openspec/changes/archive/2026-05-20-smoke-fixture
  cat > /tmp/smoke-cwd/openspec/changes/archive/2026-05-20-smoke-fixture/proposal.md <<"EOF"
## Why

Fixture for docker smoke. Verifies /api/openspec-archive scanning.
EOF
'

ARCHIVE_JSON=$(indocker 'curl -fsS "http://localhost:18000/api/openspec-archive?cwd=/tmp/smoke-cwd"' 2>/dev/null || true)
if [[ -z "$ARCHIVE_JSON" ]]; then
  echo "[smoke] FAIL: /api/openspec-archive returned empty / non-2xx" >&2
  indocker 'tail -30 ~/.pi/dashboard/server.log' >&2 || true
  exit 1
fi

# Parse + assert: success=true AND the seeded entry name appears in data[].name.
# Endpoint shape: {success:true, data:[{name, dateLabel, artifacts:[{id,status}]}, ...]}.
ARCHIVE_CHECK=$(echo "$ARCHIVE_JSON" | node -e '
let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
  try {
    const r = JSON.parse(d);
    if (!r.success) { console.log("NOT_SUCCESS:" + (r.error || "unknown")); return; }
    const entries = r.data || [];
    const found = entries.find(e => e.name === "2026-05-20-smoke-fixture");
    if (!found) { console.log("NOT_FOUND:count=" + entries.length); return; }
    const artifactIds = (found.artifacts || []).map(a => a.id).sort().join(",");
    console.log("OK:artifacts=" + (artifactIds || "<none>"));
  } catch (e) {
    console.log("PARSE_ERROR:" + e.message);
  }
})')

if [[ "$ARCHIVE_CHECK" != OK:* ]]; then
  echo "[smoke] FAIL: /api/openspec-archive did not return seeded entry" >&2
  echo "  diagnostic: $ARCHIVE_CHECK" >&2
  echo "  raw response head: $(echo "$ARCHIVE_JSON" | head -c 300)" >&2
  exit 1
fi
echo "[smoke]   /api/openspec-archive returns seeded entry (${ARCHIVE_CHECK})"

echo
echo "[smoke] ✓ All checks passed on $IMAGE."
echo "[smoke]   Local packs in $PACK_DIR are equivalent to a published release for these checks."
