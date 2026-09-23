#!/usr/bin/env bash
# Test: a CLEAN INSTALL PREFIX loads the browser plugin (test-plan X7-X11).
# See change: fix-browser-plugin-vendor-specifier-resolution.
#
# WHY THIS EXISTS, given the docker gate and the install-load guard.
# Those two prove resolution (pack → install → import) and a wrapper-launched
# boot inside the IMAGE. Neither proves the thing that actually broke for a
# user: a clean PREFIX on a real host, where discovery walks up from the loader
# module and `defaultEnabled: false` means a broken plugin is never even
# attempted. Three ways this smoke could report a clean run over a broken build,
# each closed below:
#
#   1. NOTHING DISCOVERED. A prefix with no plugin discovers zero and every
#      later assertion passes. → assert `browser` is in the discovered set.
#   2. NOTHING ENABLED. `browser` is `defaultEnabled: false`, so a boot that
#      never attempts it reports no failures. A config cannot be written before
#      discovery has run, so this boots twice: discover, enable all, boot again.
#   3. WRONG TREE. `findMonorepoRoot()` walks up from the loader module, so a
#      monorepo checkout on the same host can be loaded instead of the install.
#      → every plugin path named in the log must sit inside the prefix.
#
# The success assertion is "no plugin reported an ERROR", NOT
# `loaded == discovered`: the loader legitimately reports `loaded: false` for a
# missing/disabled dependency or an unmet `missingRequirements`, which a clean VM
# produces on healthy builds.
#
# Inputs (all optional, so the same test runs from a clean VM or from the host
# with freshly built artefacts):
#   QA_PREFIX             install prefix / throwaway HOME (default: mktemp -d)
#   QA_DASHBOARD_TARBALL  path to a locally packed dashboard tarball (the repo
#                         ROOT package, `@blackbelt-technology/pi-agent-dashboard`,
#                         whose bin is `pi-dashboard`)
#   QA_PLUGIN_TARBALL     path to a locally packed browser-plugin tarball
#   QA_EXTRA_TARBALLS     space-separated extra tarballs to install alongside
#                         them. REQUIRED with the tarball inputs, not optional:
#                         the plugin and the dashboard depend on
#                         `@blackbelt-technology/pi-dashboard-shared` and
#                         `...-dashboard-plugin-runtime`, and installing a
#                         freshly packed root tarball while those resolve from
#                         the REGISTRY mixes a new tree with a stale published
#                         copy (the hazard `bundle-server.mjs` documents). Pack
#                         and pass all first-party workspaces, or omit the
#                         tarballs entirely and let one consistent registry
#                         version supply everything.
#   QA_DASHBOARD_VERSION  registry version when no tarball is given (default latest)
#   QA_REPO_ROOT          a checkout to prove is NOT used (contamination probe)
#   QA_PORT               server port (default 18917)
#   QA_BOOT_TIMEOUT       seconds to wait for /api/health per boot (default 60)
set -euo pipefail

echo "=== Test: clean-prefix plugin install-load (X7-X11) ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

PREFIX="${QA_PREFIX:-$(mktemp -d)}"
PLUGIN_ID="browser"
PORT="${QA_PORT:-18917}"
BOOT_TIMEOUT="${QA_BOOT_TIMEOUT:-60}"
LOG="$PREFIX/.pi/dashboard/server.log"
BIN_DIR=""
FAILED=0

fail() { echo "FAIL: $*"; FAILED=1; }

# Temp space for the manifest program and any packed tarball. Created up front so
# the trap can clean it even when a step exits early.
SCRATCH_DIR=$(mktemp -d)

# Point a package.json at the given spec and force every first-party workspace in
# QA_EXTRA_TARBALLS to resolve locally. Without the overrides npm serves the
# REGISTRY copies of packages under test — the stale-copy hazard this change is
# about. An existing package.json (an unpacked tarball) is updated in place, so
# its manifest and dependencies survive.
#
# The program goes in a temp .cjs FILE rather than `node -e`: an inline program is
# at the mercy of the caller's quoting. A single apostrophe inside it silently
# truncated the script while this test was being written, and Windows PowerShell's
# legacy native-argument handling strips embedded double quotes. A file has no
# quoting surface, and the exit code is checked here instead of being ignored.
write_manifest() {
  local js="$SCRATCH_DIR/manifest.cjs"
  cat > "$js" <<'JS'
const fs = require("node:fs");
const tar = require("node:child_process");
// invoked as: node <this file> <out> <spec|-> [extraTarball...]
const [out, spec, ...extras] = process.argv.slice(2);
const nameOf = (t) => JSON.parse(tar.execFileSync("tar", ["-xzOf", t, "package/package.json"], { encoding: "utf-8" })).name;
const local = (t) => (t.endsWith(".tgz") || t.endsWith(".tar.gz") ? "file:" + t : t);
const byName = Object.fromEntries(extras.map((t) => [nameOf(t), t]));
const overrides = { ...byName };
const pkg = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf-8")) : {};
if (!pkg.name) { pkg.name = "qa-clean-prefix"; pkg.private = true; pkg.version = "0.0.0"; pkg.dependencies = {}; }
if (spec && spec !== "-") { pkg.dependencies = pkg.dependencies || {}; pkg.dependencies[nameOf(spec)] = local(spec); }
// npm REJECTS an override that conflicts with a DIRECT dependency (EOVERRIDE), so
// a first-party package that is a direct dep is pinned through the dep itself;
// the override map then carries only the TRANSITIVE ones, which is what stops a
// nested copy from coming off the registry.
for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const name of Object.keys(deps)) {
    if (byName[name]) { deps[name] = "file:" + byName[name]; delete overrides[name]; }
  }
}
if (Object.keys(overrides).length) pkg.overrides = { ...(pkg.overrides || {}), ...overrides };
fs.writeFileSync(out, JSON.stringify(pkg, null, 2));
JS
  node "$js" "$1" "${2:--}" ${QA_EXTRA_TARBALLS:-} || { fail "could not write the manifest for $1"; exit 1; }
}

cleanup() {
  if [ -n "$BIN_DIR" ]; then
    HOME="$PREFIX" PATH="$BIN_DIR:$PATH" pi-dashboard stop >/dev/null 2>&1 || true
  fi
  if [ -z "${QA_PREFIX:-}" ]; then rm -rf "$PREFIX"; fi
  rm -rf "$SCRATCH_DIR"
}
trap cleanup EXIT

echo "prefix: $PREFIX"

# ── install: dashboard + plugin, into the prefix ──────────────────────────────
DASHBOARD_SRC="${QA_DASHBOARD_TARBALL:-@blackbelt-technology/pi-agent-dashboard@${QA_DASHBOARD_VERSION:-latest}}"
PLUGIN_SRC="${QA_PLUGIN_TARBALL:-@blackbelt-technology/pi-dashboard-browser-plugin@${QA_DASHBOARD_VERSION:-latest}}"

if [ -n "${QA_DASHBOARD_TARBALL:-}${QA_PLUGIN_TARBALL:-}" ]; then
  # LOCAL-TARBALL MODE needs a NON-global install with an `overrides` map, and
  # it has to be that way: the root package declares only the three workspace
  # packages, while the third-party deps (proper-lockfile, fastify...) live in
  # packages/server — and the server source shipped INSIDE the root tarball
  # resolves them from its own nest. A global install of root + workspace
  # tarballs makes npm NEST those workspace packages, so the inlined source
  # cannot see their dependencies and the launcher dies with `Cannot find module
  # 'proper-lockfile'` — a synthetic failure saying nothing about this change.
  # `overrides` yields one flat tree instead.
  APP="$PREFIX/app"
  mkdir -p "$APP"
  write_manifest "$APP/package.json" "$DASHBOARD_SRC"
  ( cd "$APP" && npm install --omit=dev --no-audit --no-fund ) >/dev/null 2>&1 || {
    fail "npm install (local tarballs + overrides) failed in $APP"
    exit 1
  }
  BIN_DIR="$APP/node_modules/.bin"
else
  npm install -g --prefix "$PREFIX" "$DASHBOARD_SRC" >/dev/null 2>&1 || {
    # An unpublished version (a release-prep branch) must fail LOUDLY here, not
    # silently degrade into a vacuous pass.
    fail "npm install -g --prefix $PREFIX failed for $DASHBOARD_SRC"
    exit 1
  }
  BIN_DIR="$PREFIX/bin"
fi
# ── step 2: the plugin, materialised where discovery actually looks ──────────
# `discoverPlugins()` scans ONE level — `<dir>/<entry>/package.json` — so a
# SCOPED package left inside a node_modules tree appears as `@scope/`, which has
# no package.json and is never discovered. User-installed plugins consequently
# live as top-level directories under `~/.pi/dashboard/plugins/`, each carrying
# its own node_modules. That directory is what the X11 prefix assertion covers.
SCRATCH_TARBALLS="$SCRATCH_DIR/tarballs"
mkdir -p "$SCRATCH_TARBALLS"
PLUGIN_TARBALL="${QA_PLUGIN_TARBALL:-}"
if [ -z "$PLUGIN_TARBALL" ]; then
  PLUGIN_TARBALL=$(npm pack --pack-destination "$SCRATCH_TARBALLS" "$PLUGIN_SRC" 2>/dev/null | tail -1) || PLUGIN_TARBALL=""
  case "$PLUGIN_TARBALL" in /*) : ;; *tgz) PLUGIN_TARBALL="$SCRATCH_TARBALLS/$PLUGIN_TARBALL" ;; esac
fi
[ -f "$PLUGIN_TARBALL" ] || { fail "could not obtain a plugin tarball from $PLUGIN_SRC"; exit 1; }

PLUGINS_DIR="$PREFIX/.pi/dashboard/plugins/browser-plugin"
mkdir -p "$PLUGINS_DIR"
tar -xzf "$PLUGIN_TARBALL" -C "$PLUGINS_DIR" --strip-components=1 || { fail "could not unpack $PLUGIN_TARBALL"; exit 1; }
# Only the overrides apply here — adding a dependency on the plugin itself
# (its own tarball) would make npm install the package into itself.
write_manifest "$PLUGINS_DIR/package.json"
( cd "$PLUGINS_DIR" && npm install --omit=dev --no-audit --no-fund ) >/dev/null 2>&1 || {
  fail "npm install (plugin deps) failed in $PLUGINS_DIR"
  exit 1
}
echo "installed dashboard + $PLUGIN_ID plugin into $PREFIX (bin: $BIN_DIR)"

boot() {
  # `env -u JITI_TSCONFIG_PATHS` is the point: the deleted stamp must not be
  # supplied by the caller, or a green run proves nothing about a real install.
  # An explicit --port keeps this off 8000, where a dev instance may be running.
  env -u JITI_TSCONFIG_PATHS HOME="$PREFIX" PATH="$BIN_DIR:$PATH" \
    pi-dashboard start --port "$PORT" --no-tunnel >/dev/null 2>&1 || true
  local elapsed=0
  while [ "$elapsed" -lt "$BOOT_TIMEOUT" ]; do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/health" 2>/dev/null || echo 000)" = "200" ]; then
      return 0
    fi
    elapsed=$((elapsed + 2))
    sleep 2
  done
  return 1
}

stop() {
  env -u JITI_TSCONFIG_PATHS HOME="$PREFIX" PATH="$BIN_DIR:$PATH" pi-dashboard stop >/dev/null 2>&1 || true
}

plugins_json() { curl -fsS "http://localhost:$PORT/api/plugins" 2>/dev/null; }

# ── boot 1: DISCOVERY ─────────────────────────────────────────────────────────
if ! boot; then
  fail "boot 1: /api/health never answered 200 on :$PORT"
  exit 1
fi
echo "boot 1: health 200"

if ! DISCOVERED=$(plugins_json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write((j.plugins||[]).map(p=>p.id).join(' '))})"); then
  fail "GET /api/plugins did not return parseable JSON"
  exit 1
fi

# X8 — an empty prefix cannot pass.
if [ -z "$(echo "$DISCOVERED" | tr -d '[:space:]')" ]; then
  fail "no plugins discovered in a prefix with the plugin installed (vacuous-green guard)"
  exit 1
fi
echo "discovered: $DISCOVERED"

case " $DISCOVERED " in
  *" $PLUGIN_ID "*) echo "$PLUGIN_ID is discovered" ;;
  *) fail "$PLUGIN_ID is NOT in the discovered set: $DISCOVERED"; exit 1 ;;
esac

# ── enable every discovered plugin, then boot 2 ───────────────────────────────
# Must happen AFTER discovery: a config cannot be written before the plugins are
# known, and `browser` is defaultEnabled:false, so without this the boot never
# attempts it (X9).
mkdir -p "$PREFIX/.pi/dashboard"
node -e "
const fs=require('fs');
const cfgPath=process.argv[1];
let cfg={};
try{cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'))}catch{}
cfg.plugins=cfg.plugins||{};
for(const id of process.argv[2].split(/\s+/).filter(Boolean)) cfg.plugins[id]={...(cfg.plugins[id]||{}),enabled:true};
fs.writeFileSync(cfgPath, JSON.stringify(cfg,null,2));
" "$PREFIX/.pi/dashboard/config.json" "$DISCOVERED"
echo "enabled all discovered plugins"

stop
if ! boot; then
  fail "boot 2: /api/health never answered 200 on :$PORT"
  exit 1
fi
echo "boot 2: health 200"

# X7 — the launcher reports the plugin loaded.
if ! grep -q "Loaded plugin \"$PLUGIN_ID\"" "$LOG" 2>/dev/null; then
  fail "log has no 'Loaded plugin \"$PLUGIN_ID\"' after a clean-prefix boot"
  grep -iE "plugin-loader|Failed to load" "$LOG" 2>/dev/null | head -10 || true
  exit 1
fi
echo "log: 'Loaded plugin \"$PLUGIN_ID\"'"

# X10 — no ERRORED plugin. `loaded:false` alone is legitimate (missing dep /
# unmet requirement); only `status.error` means the load actually failed.
ERRORS=$(plugins_json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.stdout.write((j.plugins||[]).filter(p=>p.status&&p.status.error).map(p=>p.id+': '+p.status.error).join('\n'))})")
if [ -n "$ERRORS" ]; then
  fail "plugin(s) reported a load error:"
  printf '%s\n' "$ERRORS"
  exit 1
fi
echo "no plugin reported a load error"

# X11 — every LOADED plugin must come from the install prefix.
#
# This is the assertion that actually holds the line; the log scan below is only
# a secondary signal. `discoverPlugins()` searches a monorepo checkout as well as
# the install, and a checkout-sourced plugin that wins discovery BY ID loads
# cleanly, satisfies X7 and X10, and never names a path in the log — so a log
# scan alone reports a clean run over the wrong tree. `packageDir` is the only
# surface that distinguishes them.
OUTSIDE=$(plugins_json | PREFIX="$PREFIX" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const root=process.env.PREFIX+"/";process.stdout.write((j.plugins||[]).filter(p=>p.status&&p.status.loaded&&(!p.packageDir||!p.packageDir.startsWith(root))).map(p=>p.id+": "+(p.packageDir||"<missing packageDir>")).join("\n"))})')
if [ -n "$OUTSIDE" ]; then
  fail "loaded plugin(s) outside the install prefix (wrong-tree contamination):"
  printf '%s\n' "$OUTSIDE"
  exit 1
fi

# X11 — no plugin path outside the prefix. The log's absolute paths come from
# loader Require stacks; on a healthy boot there are none, which is why the X8/X9
# guards above carry the anti-vacuity weight. Any `/plugins/` path that DOES
# appear must be inside the prefix.
STRAY=$(grep -oE '/[^ "]*/plugins/[^ ")*]*' "$LOG" 2>/dev/null | grep -v "^$PREFIX/" | head -5 || true)
if [ -n "$STRAY" ]; then
  fail "a plugin path outside the install prefix appeared in the log (wrong-tree contamination):"
  printf '%s\n' "$STRAY"
  exit 1
fi
if [ -n "${QA_REPO_ROOT:-}" ] && grep -qF "$QA_REPO_ROOT" "$LOG" 2>/dev/null; then
  fail "the log references the checkout $QA_REPO_ROOT — a monorepo checkout can masquerade as the install"
  exit 1
fi
echo "no plugin path outside the prefix"

if [ "$FAILED" -ne 0 ]; then
  echo "FAIL: clean-prefix plugin install-load"
  exit 1
fi
echo "PASS: clean-prefix plugin install-load (X7-X11)"
