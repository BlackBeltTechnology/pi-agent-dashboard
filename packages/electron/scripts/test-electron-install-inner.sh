#!/usr/bin/env bash
#
# Inner test: runs INSIDE a clean Ubuntu 22.04 container as non-root user.
# Mirrors what packages/electron/src/lib/launch-source.ts `resolveExtracted`
# does at runtime, but in a self-contained shell+node script so we don't
# need to install Electron's main-process deps inside the test container.
#
# Stages:
#   1. Verify bundled resource layout            (Tier-A equivalent)
#   2. extractBundle    → ~/.pi-dashboard/       (cpSync from $APP_RESOURCES)
#   3. Strip workspace decl from managed pkg.json + drop bundle's lockfile
#   4. Swap-aside node_modules
#   5. installStandalone equivalent: npm install --prefix --cache from
#      offline cacache. Installs @mariozechner/pi-coding-agent + tsx + openspec.
#   6. Merge bundle node_modules back on top
#   7. Spawn server: node --import <jiti-register> <cliPath>
#   8. Health check: GET /api/health → starter:Electron
#
# See change: simplify-electron-bootstrap-derived-state (Phase C bring-up).
#
set -euo pipefail

APP_RESOURCES="${APP_RESOURCES:-/opt/pi-dashboard/resources}"
NODE_BIN="$APP_RESOURCES/node/bin/node"
NPM_BIN="$APP_RESOURCES/node/lib/node_modules/npm/bin/npm-cli.js"
SERVER_BUNDLE="$APP_RESOURCES/server"
OFFLINE_CACHE_DIR="$APP_RESOURCES/offline-packages"
MANAGED_DIR="$HOME/.pi-dashboard"
CLI_REL="node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts"

PASS=0
FAIL=0
TESTS=()

pass()  { PASS=$((PASS+1)); TESTS+=("✓ $1");      echo "  ✓ $1"; }
fail()  { FAIL=$((FAIL+1)); TESTS+=("✗ $1: $2");  echo "  ✗ $1: $2"; }
hr()    { echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

# ── Stage 1: Verify bundled layout ────────────────────────────────────────────

hr; echo "  Stage 1 — Verify bundled resource layout"; hr

[ -x "$NODE_BIN" ]                                    && pass "Bundled Node: $($NODE_BIN --version)" || fail "Bundled Node" "missing $NODE_BIN"
[ -f "$NPM_BIN" ]                                     && pass "Bundled npm present"                  || fail "Bundled npm" "missing $NPM_BIN"
[ -d "$SERVER_BUNDLE" ]                               && pass "Server bundle dir present"            || fail "Server bundle" "missing $SERVER_BUNDLE"
[ -f "$SERVER_BUNDLE/package.json" ]                  && pass "Bundle package.json present"          || fail "Bundle package.json" "missing"
[ -f "$SERVER_BUNDLE/$CLI_REL" ]                      && pass "Bundle cliPath present"               || fail "Bundle cliPath" "missing $SERVER_BUNDLE/$CLI_REL"
[ -f "$OFFLINE_CACHE_DIR/manifest.json" ]             && pass "Offline cacache manifest present"     || fail "Offline cacache" "missing $OFFLINE_CACHE_DIR/manifest.json"
[ -d "$SERVER_BUNDLE/node_modules/node-pty/prebuilds/linux-x64" ] \
                                                      && pass "node-pty linux-x64 prebuild present"  || fail "node-pty prebuild" "linux-x64 missing"

# No absolute symlinks under @blackbelt-technology/* (would resolve to
# build-time paths that don't exist on the user's machine).
ABS_LINK_FOUND=false
if [ -d "$SERVER_BUNDLE/node_modules/@blackbelt-technology" ]; then
  for entry in "$SERVER_BUNDLE/node_modules/@blackbelt-technology"/*; do
    [ -L "$entry" ] || continue
    target=$(readlink "$entry")
    case "$target" in
      /*) ABS_LINK_FOUND=true; echo "    absolute link: $entry → $target" ;;
    esac
  done
fi
$ABS_LINK_FOUND && fail "@blackbelt-technology symlinks" "absolute link present" \
                || pass "No absolute symlinks under @blackbelt-technology/*"

# ── Stage 2: extractBundle (cpSync) ───────────────────────────────────────────

echo ""; hr; echo "  Stage 2 — extractBundle: cpSync \$bundle → ~/.pi-dashboard/"; hr

mkdir -p "$MANAGED_DIR"
echo "0.0.0-test" > "$MANAGED_DIR/.version"

# cpSync with --no-dereference so symlinks are preserved (we already verified
# they're materialized to real dirs upstream). cp -a does the right thing.
cp -a "$SERVER_BUNDLE/." "$MANAGED_DIR/" \
  && pass "cpSync of bundle into managedDir" \
  || fail "cpSync bundle" "cp -a failed"

[ -f "$MANAGED_DIR/$CLI_REL" ] && pass "managedDir/cliPath exists post-extract" \
                              || fail "managedDir/cliPath" "missing after extract"

# ── Stage 3: Strip workspaces field + delete lockfile ─────────────────────────

echo ""; hr; echo "  Stage 3 — Detach build-time package.json + package-lock.json"; hr

if [ -f "$MANAGED_DIR/package.json" ]; then
  "$NODE_BIN" -e "
    const fs = require('fs');
    const p = process.argv[1];
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (j.workspaces !== undefined) {
      delete j.workspaces;
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    }
  " "$MANAGED_DIR/package.json" && pass "Stripped workspaces field" \
                                 || fail "Strip workspaces" "node failed"
fi
rm -f "$MANAGED_DIR/package-lock.json"
pass "Removed bundle's package-lock.json"

# ── Stage 4: Swap-aside node_modules ──────────────────────────────────────────

echo ""; hr; echo "  Stage 4 — Move node_modules → .bundle-node-modules"; hr

if [ -d "$MANAGED_DIR/node_modules" ]; then
  rm -rf "$MANAGED_DIR/.bundle-node-modules"
  mv "$MANAGED_DIR/node_modules" "$MANAGED_DIR/.bundle-node-modules"
  pass "Swap-aside complete"
else
  fail "Swap-aside" "no node_modules to stash"
fi

# ── Stage 5: installStandalone equivalent ─────────────────────────────────────

echo ""; hr; echo "  Stage 5 — npm install pi+tsx+openspec from offline cacache"; hr

# Read pinned versions from manifest
read PI_VERSION TSX_VERSION OPENSPEC_VERSION <<<"$(
  "$NODE_BIN" -e "
    const m = require(process.argv[1]);
    const map = Object.fromEntries(m.packages.map(p => [p.name, p.version]));
    process.stdout.write([
      map['@mariozechner/pi-coding-agent'],
      map['tsx'],
      map['@fission-ai/openspec']
    ].join(' '));
  " "$OFFLINE_CACHE_DIR/manifest.json"
)"

[ -n "${PI_VERSION:-}" ] && pass "Pinned versions: pi=$PI_VERSION tsx=$TSX_VERSION openspec=$OPENSPEC_VERSION" \
                          || fail "Manifest pin lookup" "could not parse offline-packages/manifest.json"

# Extract cacache from the gzipped tarball (mirrors offline-packages.ts
# resolveOfflinePackages → extractOfflineCache).
mkdir -p "$MANAGED_DIR/.offline-cache"
tar -xzf "$OFFLINE_CACHE_DIR/npm-cache.tar.gz" -C "$MANAGED_DIR/.offline-cache" \
  && pass "Extracted offline cacache" \
  || fail "Extract cacache" "tar failed"

cd "$MANAGED_DIR"
NPM_OUT=$("$NODE_BIN" "$NPM_BIN" install \
  --prefix "$MANAGED_DIR" \
  --cache "$MANAGED_DIR/.offline-cache" \
  --prefer-offline \
  --no-audit \
  --no-fund \
  "@mariozechner/pi-coding-agent@$PI_VERSION" \
  "tsx@$TSX_VERSION" \
  "@fission-ai/openspec@$OPENSPEC_VERSION" 2>&1 | tail -10) && INSTALL_RC=0 || INSTALL_RC=$?

if [ "$INSTALL_RC" = "0" ]; then
  pass "npm install completed (offline cacache)"
else
  fail "npm install" "exit=$INSTALL_RC"
  echo "    last 10 lines: $NPM_OUT"
fi

# ── Stage 6: Merge bundle node_modules back ───────────────────────────────────

echo ""; hr; echo "  Stage 6 — Merge .bundle-node-modules → node_modules"; hr

# cp -an: do not overwrite existing files (npm's installs win for shared
# packages where both sides wrote). We want bundle wins on conflicts in
# launch-source.ts logic, but for this test cp -an models additive merge
# which is safer when @mariozechner/* was just installed. Critical
# regressions (cliPath wipe) are caught by the next assertion either way.
cp -an "$MANAGED_DIR/.bundle-node-modules/." "$MANAGED_DIR/node_modules/" || true
rm -rf "$MANAGED_DIR/.bundle-node-modules"
pass "Bundle merge complete"

[ -f "$MANAGED_DIR/$CLI_REL" ]                                              && pass "managedDir/cliPath survived install" || fail "cliPath wiped" "merge did not restore"
[ -d "$MANAGED_DIR/node_modules/@mariozechner/pi-coding-agent" ]            && pass "@mariozechner/pi-coding-agent installed" || fail "pi-coding-agent" "missing post-install"
[ -d "$MANAGED_DIR/node_modules/@mariozechner/jiti" ]                       && pass "@mariozechner/jiti available"           || fail "jiti" "not hoisted"

# ── Stage 7: Spawn server ─────────────────────────────────────────────────────

echo ""; hr; echo "  Stage 7 — Spawn server: node --import <jiti> <cli.ts>"; hr

# Build jiti-register URL the same way launch-source.ts's resolveJitiFromAnchor does.
JITI_REGISTER="$MANAGED_DIR/node_modules/@mariozechner/jiti/lib/jiti-register.mjs"
[ -f "$JITI_REGISTER" ] && pass "jiti-register.mjs found" \
                        || fail "jiti-register" "missing $JITI_REGISTER"

PORT=8111
PI_PORT=9998

cd "$MANAGED_DIR"
DASHBOARD_STARTER=Electron "$NODE_BIN" \
  --import "file://$JITI_REGISTER" \
  "$MANAGED_DIR/$CLI_REL" \
  --port "$PORT" \
  --pi-port "$PI_PORT" \
  > /tmp/server.log 2>&1 &
SERVER_PID=$!

# ── Stage 8: Health check ─────────────────────────────────────────────────────

echo ""; hr; echo "  Stage 8 — Wait for /api/health (max 120s)"; hr

DEADLINE=$((SECONDS + 120))
SERVER_UP=false
HEALTH_BODY=""
while [ $SECONDS -lt $DEADLINE ]; do
  sleep 1
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "  ⚠ Server process exited"; break
  fi
  if HEALTH_BODY=$(curl -sf "http://localhost:$PORT/api/health" 2>/dev/null); then
    SERVER_UP=true; break
  fi
done

if [ "$SERVER_UP" = "true" ]; then
  pass "/api/health responded"
  STARTER=$(echo "$HEALTH_BODY" | "$NODE_BIN" -e \
    "process.stdin.on('data', d=>{try{process.stdout.write(JSON.parse(d).starter||'?');}catch{process.stdout.write('?');}})")
  if [ "$STARTER" = "Electron" ]; then
    pass "starter == Electron"
  else
    fail "starter" "expected Electron, got $STARTER"
  fi
else
  fail "Server health" "did not respond within 120s"
  echo ""; echo "  Server log (last 60 lines):"; tail -60 /tmp/server.log 2>/dev/null || echo "  (no log)"
fi

# Cleanup
if kill -0 "$SERVER_PID" 2>/dev/null; then
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
fi

# ── Stage 9: Degraded re-extract recovery ───────────────────────────
#
# Catches the v0.4.6 regression where the version marker matches but
# ~/.pi-dashboard/node_modules/@mariozechner is missing (AV quarantine,
# partial uninstall, npm prune). Bash counterpart of the vitest Tier-B
# smoke in launch-source.smoke.test.ts. See change:
# expand-electron-qa-coverage and fix-electron-extracted-jiti-and-stdio-capture.

echo ""; hr; echo "  Stage 9 — Degraded re-extract recovery"; hr

# Wipe the @mariozechner subtree to simulate corruption.
rm -rf "$MANAGED_DIR/node_modules/@mariozechner"
[ ! -d "$MANAGED_DIR/node_modules/@mariozechner/jiti" ] \
  && pass "precondition: @mariozechner wiped" \
  || fail "precondition" "failed to wipe @mariozechner subtree"

# Stash @blackbelt-technology so re-install does not prune it.
STASH_DIR="$MANAGED_DIR/.bundle-node-modules-stage9"
rm -rf "$STASH_DIR"
if [ -d "$MANAGED_DIR/node_modules" ]; then
  mv "$MANAGED_DIR/node_modules" "$STASH_DIR"
fi

cd "$MANAGED_DIR"
NPM_OUT9=$("$NODE_BIN" "$NPM_BIN" install \
  --prefix "$MANAGED_DIR" \
  --cache "$MANAGED_DIR/.offline-cache" \
  --prefer-offline \
  --no-audit \
  --no-fund \
  "@mariozechner/pi-coding-agent@$PI_VERSION" \
  "tsx@$TSX_VERSION" \
  "@fission-ai/openspec@$OPENSPEC_VERSION" 2>&1 | tail -10) && S9_RC=0 || S9_RC=$?

if [ "$S9_RC" = "0" ]; then
  pass "recovery npm install completed"
else
  fail "recovery npm install" "exit=$S9_RC"
  echo "    last 10 lines: $NPM_OUT9"
fi

cp -an "$STASH_DIR/." "$MANAGED_DIR/node_modules/" 2>/dev/null || true
rm -rf "$STASH_DIR"

[ -d "$MANAGED_DIR/node_modules/@mariozechner/jiti" ] \
  && pass "jiti restored after recovery" \
  || fail "jiti restore" "recovery did not bring @mariozechner/jiti back"
[ -f "$MANAGED_DIR/$CLI_REL" ] \
  && pass "cliPath survived recovery" \
  || fail "cliPath" "wiped during recovery merge"

# Re-spawn server and re-assert /api/health.
PORT2=8112
PI_PORT2=9997
DASHBOARD_STARTER=Electron "$NODE_BIN" \
  --import "file://$JITI_REGISTER" \
  "$MANAGED_DIR/$CLI_REL" \
  --port "$PORT2" \
  --pi-port "$PI_PORT2" \
  > /tmp/server-stage9.log 2>&1 &
SERVER_PID2=$!

DEADLINE9=$((SECONDS + 90))
SERVER_UP9=false
while [ $SECONDS -lt $DEADLINE9 ]; do
  sleep 1
  if ! kill -0 "$SERVER_PID2" 2>/dev/null; then
    echo "  ⚠ Recovery server process exited"; break
  fi
  if curl -sf "http://localhost:$PORT2/api/health" >/dev/null 2>&1; then
    SERVER_UP9=true; break
  fi
done

if [ "$SERVER_UP9" = "true" ]; then
  pass "recovery /api/health responded"
else
  fail "recovery health" "did not respond within 90s"
  echo ""; echo "  Stage 9 server log (last 60 lines):"; tail -60 /tmp/server-stage9.log 2>/dev/null || echo "  (no log)"
fi

# Stage-9 stdio assertion: server log must be non-empty after a
# successful spawn. Catches the spawnDetached stdio[1]='ignore'
# regression symptom (empty log file). Real spawnDetached coverage
# is the unit test in detached-spawn.test.ts.
if [ "$SERVER_UP9" = "true" ]; then
  if [ -s /tmp/server-stage9.log ]; then
    pass "recovery server log non-empty"
  else
    fail "recovery server log" "0 bytes after successful spawn (stdio regression?)"
  fi
fi

if kill -0 "$SERVER_PID2" 2>/dev/null; then
  kill "$SERVER_PID2" 2>/dev/null || true
  wait "$SERVER_PID2" 2>/dev/null || true
fi


# ── Results ───────────────────────────────────────────────────────────────────

echo ""; hr; echo "  Results"; hr; echo ""
for t in "${TESTS[@]}"; do echo "  $t"; done
echo ""; echo "  $PASS passed, $FAIL failed"; echo ""

[ $FAIL -gt 0 ] && exit 1 || exit 0
