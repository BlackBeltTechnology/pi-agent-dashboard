#!/usr/bin/env bash
# Shared helpers for the dist-only plugin VM scripts (qa/tests/47..51-*.sh). Lives in qa/tests so
# run-test.sh uploads it with the scripts that source it.
# SOURCE it; it defines functions only (no side effects besides `set` of nothing).
# See change: decouple-plugins-from-core (tasks 7.8, 8.103, 8.138, 8.140-8.142).
#
# "dist-only" = an npm install of the dashboard into a CLEAN prefix: no monorepo root, no toolchain.
# The install mirrors `qa/tests/35-plugin-install-load.sh`; this lib is the part the five plugin
# scripts share so each stays hermetic (own prefix, own port) without copying 80 lines.
#
# Inputs (all optional):
#   QA_PREFIX             install prefix / throwaway HOME (default: mktemp -d /tmp/qa-do.XXXXXX; removed on exit)
#   QA_BIN_DIR            directory holding an already-installed `pi-dashboard` (skips the install; the
#                         caller owns it — used to dry-run these scripts against a checkout)
#   QA_DASHBOARD_TARBALL / QA_EXTRA_TARBALLS / QA_DASHBOARD_VERSION   same meaning as in 35
#   QA_CANARY_DIR         a STAGED runtime canary plugin dir (`node scripts/stage-runtime-canary.mjs
#                         --out <d> --mode untrusted` on a build host → `<d>/plugins/runtime-canary`)
#   QA_PORT               server port (each script has its own default)
#   QA_BOOT_TIMEOUT       seconds to wait for /api/health per boot (default 90)
#
# Conventions: a script that cannot run prints `SKIP: <why>` FIRST and exits 0 (run-all.sh renders SKIP).

do_fail() { echo "FAIL: $*"; exit 1; }

# do_init <label> <default-port> — sets PREFIX PORT BASE SCRATCH LOG BOOT_TIMEOUT, installs the EXIT trap.
do_init() {  # $1 = script label (informational), $2 = default port
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  PORT="${QA_PORT:-$2}"
  # Short path on purpose: the keeper binds a unix socket under $PREFIX/.pi/dashboard/sessions (sun_path ≤ 104 on macOS).
  PREFIX="${QA_PREFIX:-$(mktemp -d /tmp/qa-do.XXXXXX)}"
  SCRATCH=$(mktemp -d)
  BASE="http://localhost:$PORT"
  LOG="$PREFIX/.pi/dashboard/server.log"; export LOG
  BOOT_TIMEOUT="${QA_BOOT_TIMEOUT:-90}"
  BIN_DIR="${QA_BIN_DIR:-}"
  DO_STARTED=0
  trap do_cleanup EXIT
}

# do_banner — printed by the script AFTER it has decided not to SKIP (a SKIP must be the first output line).
do_banner() { echo "prefix: $PREFIX  port: $PORT"; }

do_cleanup() {
  local rc=$?
  # Optional per-script hook (e.g. shut a spawned session down) while the server is still up.
  if [ -n "${DO_ON_EXIT:-}" ]; then "$DO_ON_EXIT" || true; fi
  if [ "${DO_STARTED:-0}" = "1" ]; then do_stop; fi
  if [ -z "${QA_PREFIX:-}" ]; then rm -rf "$PREFIX"; fi
  rm -rf "$SCRATCH"
  return $rc
}

# do_cli <args...> — run `pi-dashboard` against the prefix (HOME) with the stamp the real launcher must not need.
do_cli() { env -u JITI_TSCONFIG_PATHS HOME="$PREFIX" PATH="$BIN_DIR:$PATH" pi-dashboard "$@"; }

# do_install — dashboard into the prefix (skipped with QA_BIN_DIR). Sets BIN_DIR.
do_install() {
  if [ -n "$BIN_DIR" ]; then echo "using installed pi-dashboard from $BIN_DIR"; return 0; fi
  local spec="${QA_DASHBOARD_TARBALL:-@blackbelt-technology/pi-agent-dashboard@${QA_DASHBOARD_VERSION:-latest}}"
  if [ -n "${QA_DASHBOARD_TARBALL:-}" ]; then
    # Local tarballs need a NON-global install with an `overrides` map (see 35-plugin-install-load.sh):
    # a global install of root + workspace tarballs nests the workspaces and the inlined server source
    # then cannot see its dependencies.
    local app="$PREFIX/app" js="$SCRATCH/manifest.cjs"
    mkdir -p "$app"
    cat > "$js" <<'JS'
const fs = require("node:fs");
const cp = require("node:child_process");
const [out, spec, ...extras] = process.argv.slice(2);
const nameOf = (t) => JSON.parse(cp.execFileSync("tar", ["-xzOf", t, "package/package.json"], { encoding: "utf-8" })).name;
const byName = Object.fromEntries(extras.map((t) => [nameOf(t), t]));
const deps = { [nameOf(spec)]: "file:" + spec };
const overrides = {};
for (const [name, t] of Object.entries(byName)) {
  if (name in deps) deps[name] = "file:" + t; else overrides[name] = "file:" + t;
}
fs.writeFileSync(out, JSON.stringify({ name: "qa-clean-prefix", private: true, version: "0.0.0", dependencies: deps, ...(Object.keys(overrides).length ? { overrides } : {}) }, null, 2));
JS
    # shellcheck disable=SC2086
    node "$js" "$app/package.json" "$spec" ${QA_EXTRA_TARBALLS:-} || do_fail "could not write the install manifest"
    ( cd "$app" && npm install --omit=dev --no-audit --no-fund ) >/dev/null 2>&1 || do_fail "npm install (local tarballs) failed in $app"
    BIN_DIR="$app/node_modules/.bin"
  else
    npm install -g --prefix "$PREFIX" "$spec" >/dev/null 2>&1 || do_fail "npm install -g --prefix $PREFIX failed for $spec"
    BIN_DIR="$PREFIX/bin"
  fi
  echo "installed dashboard into $PREFIX (bin: $BIN_DIR)"
}

# do_pack_fixtures — writes the two pi-package fixture plugins (ok + throws) into $FIX (no registry).
# run-test.sh uploads pack-fixture-plugin.mjs next to the scripts; a checkout has it under qa/scripts.
do_pack_fixtures() {
  # shellcheck disable=SC2034  # FIX_* / SENTINEL_OK are read by the sourcing scripts
  local lib packer="" cand
  lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  for cand in "$lib/pack-fixture-plugin.mjs" "$lib/../scripts/pack-fixture-plugin.mjs"; do
    [ -f "$cand" ] && { packer="$cand"; break; }
  done
  [ -n "$packer" ] || do_fail "pack-fixture-plugin.mjs not found next to the scripts or under qa/scripts"
  FIX="$SCRATCH/fixtures"
  node "$packer" --out "$FIX" >/dev/null || do_fail "could not pack the fixture plugins into $FIX"
  FIX_OK="$FIX/qa-fixture-plugin"; FIX_THROWS="$FIX/qa-fixture-plugin-throws"
  SENTINEL_OK="$FIX/qa-fixture-plugin.loaded"
}

# do_config_port — pin the pi gateway port off the default so a second dashboard on the VM never collides.
do_config_port() {
  mkdir -p "$PREFIX/.pi/dashboard"
  PIPORT=$((PORT + 1000)) CFG="$PREFIX/.pi/dashboard/config.json" node -e '
    const fs = require("fs"); let c = {};
    try { c = JSON.parse(fs.readFileSync(process.env.CFG, "utf8")); } catch {}
    c.piPort = Number(process.env.PIPORT);
    fs.writeFileSync(process.env.CFG, JSON.stringify(c, null, 2));'
}

# do_boot — start the server on $PORT and wait for /api/health 200. Returns 1 on timeout.
do_boot() {
  do_cli start --port "$PORT" --no-tunnel >/dev/null 2>&1 || true
  DO_STARTED=1
  local elapsed=0
  while [ "$elapsed" -lt "$BOOT_TIMEOUT" ]; do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" 2>/dev/null || echo 000)" = "200" ] && return 0
    elapsed=$((elapsed + 2)); sleep 2
  done
  return 1
}

do_stop() { do_cli stop --port "$PORT" >/dev/null 2>&1 || true; DO_STARTED=0; }

# do_restart — `pi-dashboard restart` (delegates to /api/restart), then wait until health answers with a NEW pid.
do_restart() {
  local old new elapsed=0
  old=$(health_field pid)
  do_cli restart --port "$PORT" >/dev/null 2>&1 || do_fail "pi-dashboard restart failed"
  while [ "$elapsed" -lt "$BOOT_TIMEOUT" ]; do
    new=$(health_field pid 2>/dev/null || true)
    if [ -n "$new" ] && [ "$new" != "$old" ]; then return 0; fi
    elapsed=$((elapsed + 2)); sleep 2
  done
  do_fail "server did not come back with a new pid after restart (old pid $old)"
}

# jx '<js expr over j>' — read JSON on stdin, print the expression's value ("" for undefined/null).
jx() {
  JX="$1" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j; try { j = JSON.parse(s); } catch (e) { console.error("jx: not JSON: " + s.slice(0, 200)); process.exit(3); }
      const r = new Function("j", "return (" + process.env.JX + ")")(j);
      process.stdout.write(r === undefined || r === null ? "" : typeof r === "object" ? JSON.stringify(r) : String(r));
    });'
}

health_field() { curl -fsS "$BASE/api/health" | jx "j.$1"; }

# api <METHOD> <path> [json-body] — prints the body; the status lands in a FILE (read it with `api_code`) so it
# survives the `$(api …)` subshell. Loopback, no credentials (genuinely local).
api() {
  local method="$1" path="$2" body="${3:-}" out="$SCRATCH/api.out" code
  if [ -n "$body" ]; then
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" -H 'content-type: application/json' --data "$body" "$BASE$path" 2>/dev/null || echo 000)
  else
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "$BASE$path" 2>/dev/null || echo 000)
  fi
  printf '%s' "$code" > "$SCRATCH/api.code"
  cat "$out"
}
api_code() { cat "$SCRATCH/api.code"; }

# plugin_row <id> — the `/api/plugins` row (JSON) or empty.
plugin_row() { api GET /api/plugins | jx "JSON.stringify((j.plugins||[]).find(p=>p.id===\"$1\")||null)" | grep -v '^null$' || true; }

# wait_until <secs> <description> <command...> — poll every 1 s until the command succeeds.
wait_until() {
  local secs="$1" what="$2"; shift 2
  local i=0
  while [ "$i" -lt "$secs" ]; do "$@" >/dev/null 2>&1 && return 0; i=$((i + 1)); sleep 1; done
  do_fail "timed out after ${secs}s waiting for: $what"
}

# row_has <id> <js predicate over row r> — succeeds when the row exists and the predicate holds.
row_has() {
  local row; row=$(plugin_row "$1")
  [ -n "$row" ] || return 1
  [ "$(printf '%s' "$row" | jx "(r=>!!($2))(j)")" = "true" ]
}

# do_stage_canary — copy $QA_CANARY_DIR into the prefix plugins dir (UNTRUSTED: no trust entry is written).
do_stage_canary() {
  [ -n "${QA_CANARY_DIR:-}" ] && [ -f "$QA_CANARY_DIR/package.json" ] || return 1
  mkdir -p "$PREFIX/.pi/dashboard/plugins"
  cp -R "$QA_CANARY_DIR" "$PREFIX/.pi/dashboard/plugins/runtime-canary"
}

# dist_digest — stable digest of every file under any `dist/` of the installed first-party packages
# (path + mtimeMs + size). Unchanged across a runtime trust grant proves nothing was rebuilt.
dist_digest() {
  BIN_DIR="$BIN_DIR" node -e '
    const fs = require("fs"), path = require("path"), crypto = require("crypto");
    const bin = fs.realpathSync(path.join(process.env.BIN_DIR, "pi-dashboard"));
    let root = path.dirname(bin);
    while (root !== path.dirname(root) && !fs.existsSync(path.join(root, "package.json"))) root = path.dirname(root);
    // …/node_modules/@blackbelt-technology/<pkg> → the node_modules holding every first-party copy.
    const nm = root.split(path.sep).includes("node_modules") ? root.slice(0, root.lastIndexOf(path.sep + "node_modules") + "/node_modules".length) : null;
    // A checkout dry-run (QA_BIN_DIR → packages/server/bin) has no node_modules scope: its siblings are the packages.
    const scopes = nm ? [path.join(nm, "@blackbelt-technology")] : [path.join(root, "node_modules", "@blackbelt-technology"), path.dirname(root)];
    const files = [];
    const walk = (dir, inDist) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, inDist || e.name === "dist");
        else if (inDist) { const st = fs.statSync(p); files.push(p + "\t" + st.mtimeMs + "\t" + st.size); }
      }
    };
    walk(root, false);
    for (const s of scopes) if (fs.existsSync(s)) for (const pkg of fs.readdirSync(s)) walk(path.join(s, pkg), false);
    const uniq = [...new Set(files)].sort();
    if (!uniq.length) { console.error("dist_digest: no dist files found under " + root); process.exit(4); }
    console.log(uniq.length + ":" + crypto.createHash("sha256").update(uniq.join("\n")).digest("hex"));'
}
