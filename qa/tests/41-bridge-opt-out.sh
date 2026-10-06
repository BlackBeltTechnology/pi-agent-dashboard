#!/usr/bin/env bash
# Test: per-process bridge opt-out (PI_DASHBOARD_BRIDGE / bridge.enabled).
#
# Covers test-plan X2 (env off is inert, control arm attaches), X3 (config
# bridge.enabled:false is inert, env on overrides), X4 (dashboard headless
# spawn still attaches under bridge.enabled:false) and X5 (same for the tmux
# strategy; skipped when tmux is absent). See change: add-bridge-env-opt-out.
#
# Deliberately NO faux fixture / model: the faux-model-integration-tests spec
# allows exactly one faux-backed VM smoke (10-faux-model.sh). The bridge
# registers at session_start, so no prompt is ever driven here. Only the
# `/ws` session_added snapshot-diff pattern is borrowed from 10-faux-model.sh.
# Env: DASHBOARD_PORT (default 8000; the docker harness serves on its derived port).
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (bridge opt-out smoke requires pi installed)"
  exit 0
fi

echo "=== Test: bridge env/config opt-out ==="

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PORT="${DASHBOARD_PORT:-8000}"
CONFIG="$HOME/.pi/dashboard/config.json"
BACKUP=$(mktemp)
HAD_CONFIG=0
if [ -f "$CONFIG" ]; then cp "$CONFIG" "$BACKUP"; HAD_CONFIG=1; fi

STARTED_SERVER=0
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/api/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  pi-dashboard start &
  STARTED_SERVER=1
  ELAPSED=0
  while [ $ELAPSED -lt 15 ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/api/health 2>/dev/null || echo "000")
    [ "$HTTP_CODE" = "200" ] && break
    sleep 1; ELAPSED=$((ELAPSED + 1))
  done
fi

cleanup() {
  # Always restore the operator's config, even on a red run.
  if [ "$HAD_CONFIG" = "1" ]; then cp "$BACKUP" "$CONFIG"; else rm -f "$CONFIG"; fi
  rm -f "$BACKUP"
  [ "$STARTED_SERVER" = "1" ] && pi-dashboard stop 2>/dev/null || true
}
trap cleanup EXIT

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: dashboard server not reachable (health=$HTTP_CODE)"
  exit 1
fi

HAS_TMUX=0
command -v tmux >/dev/null 2>&1 && HAS_TMUX=1

cd "$REPO_ROOT"
PORT="$PORT" CONFIG="$CONFIG" HAS_TMUX="$HAS_TMUX" node -e '
const WebSocket = require("ws");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CONFIG = process.env.CONFIG;
const BASE = `http://localhost:${process.env.PORT}`;
const children = [];

const readCfg = () => { try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")); } catch { return {}; } };
const original = readCfg();
const writeCfg = (patch) => {
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ ...original, ...patch }, null, 2));
};
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const tmpCwd = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `bridge-optout-${tag}-`));

/** Run `action`, resolve the first NEW session (matching cwd) seen on /ws, or null on timeout. */
function observe(cwd, action, timeoutMs) {
  return new Promise((resolve, reject) => {
    const pre = new Set();
    let armed = false;
    const ws = new WebSocket(`ws://localhost:${process.env.PORT}/ws`);
    const finish = (v) => { clearTimeout(t); try { ws.close(); } catch {} resolve(v); };
    const t = setTimeout(() => finish(null), timeoutMs);
    ws.on("error", (e) => { clearTimeout(t); reject(new Error("ws error: " + e.message)); });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type !== "session_added" || !m.session || !m.session.id) return;
      if (!armed) { pre.add(m.session.id); return; }
      if (pre.has(m.session.id)) return;
      if (m.session.cwd && real(m.session.cwd) !== real(cwd)) return;
      finish(m.session.id);
    });
    ws.on("open", () => setTimeout(() => {
      armed = true;
      Promise.resolve(action()).catch((e) => { clearTimeout(t); reject(e); });
    }, 500));
  });
}

function userPi(cwd, envPatch) {
  const env = { ...process.env, ...envPatch };
  for (const [k, v] of Object.entries(envPatch)) if (v === undefined) delete env[k];
  const child = spawn("pi", ["--mode", "rpc"], { cwd, env, stdio: ["pipe", "ignore", "inherit"] });
  children.push(child);
  return child;
}

async function shutdown(id) {
  if (!id) return;
  await fetch(`${BASE}/api/session/${id}/shutdown`, { method: "POST" }).catch(() => {});
}

async function restSpawn(cwd) {
  const r = await fetch(`${BASE}/api/session/spawn`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  if (r.status !== 200) throw new Error("spawn POST status " + r.status);
}

const killAll = () => { for (const c of children.splice(0)) { try { c.kill("SIGKILL"); } catch {} } };
const fail = (m) => { killAll(); console.log("FAIL: " + m); process.exit(1); };

async function userArm(label, cfgPatch, envPatch, expectAttach) {
  writeCfg(cfgPatch);
  const cwd = tmpCwd(label);
  const id = await observe(cwd, () => userPi(cwd, envPatch), 15000);
  killAll();
  await shutdown(id);
  if (expectAttach && !id) fail(`${label}: expected the bridge to register, none seen in 15s`);
  if (!expectAttach && id) fail(`${label}: expected an inert bridge, but session ${id} registered`);
  console.log(`  ok ${label}: ${expectAttach ? "registered" : "inert"}`);
}

async function spawnArm(label, strategy) {
  writeCfg({ bridge: { enabled: false }, spawnStrategy: strategy });
  const cwd = tmpCwd(label);
  const id = await observe(cwd, () => restSpawn(cwd), 60000);
  await shutdown(id);
  if (!id) fail(`${label}: dashboard ${strategy} spawn did not register under bridge.enabled:false`);
  console.log(`  ok ${label}: dashboard ${strategy} spawn registered despite bridge.enabled:false`);
}

(async () => {
  // X2: env off is inert; control arm (env unset) attaches.
  await userArm("X2-A", {}, { PI_DASHBOARD_BRIDGE: "off" }, false);
  await userArm("X2-B", {}, { PI_DASHBOARD_BRIDGE: undefined }, true);
  // X3: config off is inert; env on overrides config.
  await userArm("X3-A", { bridge: { enabled: false } }, { PI_DASHBOARD_BRIDGE: undefined }, false);
  await userArm("X3-B", { bridge: { enabled: false } }, { PI_DASHBOARD_BRIDGE: "on" }, true);
  // X4: dashboard headless spawn always attaches.
  await spawnArm("X4", "headless");
  // X5: dashboard tmux spawn always attaches (pane env via -e).
  if (process.env.HAS_TMUX === "1") await spawnArm("X5", "tmux");
  else console.log("  skip X5: tmux not installed");
  killAll();
  process.exit(0);
})().catch((e) => fail(e.message));
'

echo "PASS: bridge env/config opt-out"
