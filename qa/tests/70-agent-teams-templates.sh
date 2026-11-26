#!/usr/bin/env bash
# Test: agent-teams templates + hooks + plan approval — process-level smoke (L2).
# See change: add-agent-teams-templates-hooks (test-plan #I2 = 15.10, #D12 = 15.1, #P3 = 15.3).
#
#   install  (#I2)  a dist-only install loads the plugin: its row is `loaded` without an error, the six
#                   templates-hooks routes answer (a registered route answers its own JSON error — an
#                   unregistered one cannot), the installed manifest carries the `sidebar-folder-section`
#                   claim and both `custom-entry-renderer` claims; and — when `yaml` is a private copy of the
#                   plugin — a missing `yaml` takes the plugin down, never the host (health 200, same process).
#   restart  (#D12) a real server restart on the faux model: (A) a team started by `/agent-team start` with
#                   two eager members and a blocking `TaskCreated` hook is restarted mid-run, after the
#                   template FILE lost its hook: the same team, the same two members (no duplicates), the same
#                   tasks, and the frozen hook still blocks (snapshot, not file); (B) a REST start restarted
#                   right after it answered reaches exactly one outcome: active with the roster spawned once
#                   and ONE playbook mail, or closed `lead_spawn_failed` — never stuck `starting`.
#   soak     (#P3)  1000 hook runs (exit 0 / 2 / 1 / timeout / overflow) through the REAL hook engine and the
#                   real shell for QA_SOAK_SECONDS (default 180): 0 surviving child pids after settle, open-fd
#                   delta <= 5, RSS slope <= 5 MB per 1000 runs. Needs a checkout (`npx tsx`) only.
#
# Hermetic: own prefix (HOME), own port (default 18970), the faux provider staged under the prefix. Inputs are
# those of dist-only-lib.sh (QA_PREFIX, QA_BIN_DIR, QA_DASHBOARD_TARBALL, QA_EXTRA_TARBALLS, QA_PORT, ...) plus
#   QA_TEMPLATES_SECTIONS  space-separated subset of "install restart soak" (default: all three)
#   QA_SOAK_SECONDS        soak duration in seconds (default 180)
#   QA_REPO_ROOT           checkout used by the soak harness and the faux fixture (default: this repo)
# SKIPs (`SKIP:` first line + exit 0) when no section can run (no `pi` for restart, no checkout for soak, ...).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${QA_REPO_ROOT:-$(cd "$HERE/../.." && pwd)}"
FIXTURE_DIR="$REPO_ROOT/qa/fixtures"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"

SECTIONS="${QA_TEMPLATES_SECTIONS:-install restart soak}"
want() { case " $SECTIONS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# ── which sections can run here ────────────────────────────────────────────────
RUN_INSTALL=0; RUN_RESTART=0; RUN_SOAK=0
want install && RUN_INSTALL=1
if want restart; then
  if command -v pi >/dev/null 2>&1 && [ -f "$FIXTURE_DIR/faux-provider.ext.ts" ] && [ -f "$FIXTURE_DIR/faux-scenarios.ts" ]; then RUN_RESTART=1; else echo "NOTE: restart section needs pi on PATH and the faux fixtures under $FIXTURE_DIR"; fi
fi
if want soak; then
  if [ -f "$REPO_ROOT/packages/agent-teams-plugin/src/server/hook-engine.ts" ] && command -v npx >/dev/null 2>&1; then RUN_SOAK=1; else echo "NOTE: soak section needs a checkout with packages/agent-teams-plugin and npx"; fi
fi
if [ $((RUN_INSTALL + RUN_RESTART + RUN_SOAK)) -eq 0 ]; then
  echo "SKIP: no agent-teams templates section can run here (sections: $SECTIONS)"
  exit 0
fi

echo "=== Test: agent-teams templates + hooks (install=$RUN_INSTALL restart=$RUN_RESTART soak=$RUN_SOAK) ==="

# ── soak (no server needed) ────────────────────────────────────────────────────
run_soak() {
  echo "--- soak (#P3): 1000 real hook runs ---"
  local harness="$SCRATCH/soak.mts"
  cat > "$harness" <<'TS'
// Drives the real hook engine + real bash. Run by `npx tsx` from the repo root (env: REPO, SOAK_SECONDS).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.env.REPO as string;
const SERVER = `${REPO}/packages/agent-teams-plugin/src`;
const SECONDS = Number(process.env.SOAK_SECONDS ?? 180);
const RUNS = 1000;
const WORKERS = 4;
const RUN = `${process.pid}-${Date.now()}`;
const MARK = `at-soak-${RUN}`;
const LONG_SLEEP = "sleep 3173"; // a distinctive argv so grandchildren can be found

const { createConfigReader } = await import(`${SERVER}/server/config.ts`);
const { createHookEngine } = await import(`${SERVER}/server/hook-engine.ts`);
const { createHookGates } = await import(`${SERVER}/server/hooks.ts`);
const { defaultHookIo } = await import(`${SERVER}/server/hook-run.ts`);
const { createPluginCounters } = await import(`${SERVER}/server/templates-hooks.ts`);
const { systemClock } = await import(`${SERVER}/shared/clock.ts`);

const logs: string[] = [];
const logger = { info: () => {}, warn: (m: string) => void logs.push(m), error: (m: string) => void logs.push(m) };
const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "at-soak-")));
const teams = new Map<string, any>();
const deps: any = {
  clock: systemClock,
  logger,
  config: createConfigReader(() => ({ hookTimeoutMs: 800, opGateBudgetMs: 12000 }), logger),
  counters: createPluginCounters(),
  store: { get: (id: string) => teams.get(id), member: (t: any, n: string) => t.members.find((m: any) => m.name === n) },
  ops: { enqueueLeadNotice: () => undefined, sendServerMail: () => ({ ok: true, data: { mailId: 1 } }) },
};
const gates = createHookGates(deps, createHookEngine(deps, defaultHookIo));

const makeTeam = (id: string) => {
  const team = {
    id, name: id, leadConnected: true, leadCwd: cwd, mode: "session", status: "active", committer: "lead", maxTeammates: 4,
    members: [{ name: "alice", spawnToken: "t", cwd, status: "busy", guardActive: true, noMcp: true, noContextFiles: true, lastSettleId: 0 }],
    tasks: [{ id: "1", title: "t", description: "d", status: "in_progress", owner: "alice", blockedBy: [], createdBy: "lead", createdAt: 0 }],
    nextTaskId: 2, nextMailId: 1, createdAt: 0, schemaVersion: 1,
  };
  teams.set(id, team);
  return team;
};

/** One run per i: the mix is 60% exit 0, 15% exit 2, 10% exit 1, 5% timeout, 10% output overflow. */
function commandFor(i: number): string {
  const k = i % 20;
  const m = `: ${MARK};`;
  if (k < 12) return `${m} exit 0`;
  if (k < 15) return `${m} echo "soak says no" >&2; exit 2`;
  if (k < 17) return `${m} exit 1`;
  if (k === 17) return `${m} ${LONG_SLEEP}`;
  return `${m} head -c 70000 /dev/zero | tr '\\0' x; exit 0`;
}

const fds = (): number => fs.readdirSync("/dev/fd").length;
const gc = (globalThis as { gc?: () => void }).gc; // NODE_OPTIONS=--expose-gc: sample RSS after a collection so it measures retention, not GC timing
const rssMb = (): number => {
  gc?.();
  return process.memoryUsage().rss / 1048576;
};
const pids = (pattern: string): number[] => {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).split("\n").filter(Boolean).map(Number).filter((p) => p !== process.pid);
  } catch {
    return []; // pgrep exits 1 on no match
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const verdicts = { allow: 0, block: 0 };
let done = 0;
const samples: Array<{ n: number; rss: number }> = [];
let fdBase = -1;
const pace = (SECONDS * 1000 * WORKERS) / RUNS;

async function worker(w: number): Promise<void> {
  const team = makeTeam(`soak-${w}`);
  for (let i = w; i < RUNS; i += WORKERS) {
    const started = Date.now();
    team.hooks = { TaskCompleted: [{ command: commandFor(i), timeoutMs: 800 }] };
    const res = await gates.taskCompleted({ op: "TaskUpdate", team, callerName: "alice", args: { id: "1", status: "completed", result: "r" } });
    if (res && (res as any).block) verdicts.block++;
    else verdicts.allow++;
    done++;
    if (done === 50) fdBase = fds();
    if (done >= 100 && done % 100 === 0) samples.push({ n: done, rss: rssMb() });
    await sleep(Math.max(0, pace - (Date.now() - started)));
  }
}

await Promise.all(Array.from({ length: WORKERS }, (_, w) => worker(w)));
await sleep(4000); // SIGTERM + the 2 s kill grace, then let the reapers settle
const survivors = [...pids(MARK), ...pids(LONG_SLEEP)];
const fdDelta = fds() - fdBase;
const xs = samples.slice(2);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const mx = mean(xs.map((s) => s.n));
const my = mean(xs.map((s) => s.rss));
const slopePerRun = xs.reduce((s, p) => s + (p.n - mx) * (p.rss - my), 0) / xs.reduce((s, p) => s + (p.n - mx) ** 2, 0);
const slope = slopePerRun * 1000;
const counters = deps.counters.snapshot();
fs.rmSync(cwd, { recursive: true, force: true });
console.log(`runs=${done} allow=${verdicts.allow} block=${verdicts.block} survivors=${survivors.length} fdDelta=${fdDelta} rssSlopeMBper1000=${slope.toFixed(2)} counters=${JSON.stringify(counters)}`);
const problems: string[] = [];
if (done !== RUNS) problems.push(`only ${done}/${RUNS} runs finished`);
if (survivors.length > 0) problems.push(`${survivors.length} surviving child pid(s): ${survivors.join(",")}`);
if (fdDelta > 5) problems.push(`open-fd delta ${fdDelta} > 5`);
if (xs.length >= 3 && slope > 5) problems.push(`RSS slope ${slope.toFixed(2)} MB/1000 runs > 5`);
if (problems.length > 0) {
  console.log("FAIL: " + problems.join("; "));
  process.exit(1);
}
console.log("OK soak");
TS
  ( cd "$REPO_ROOT" && REPO="$REPO_ROOT" SOAK_SECONDS="${QA_SOAK_SECONDS:-180}" NODE_OPTIONS="--expose-gc" npx tsx "$harness" ) || do_fail "hook soak failed (see the line above)"
  echo "PASS (#P3): hook soak — no surviving child, flat fds and RSS"
}

# The soak needs no dashboard: with only that section selected there is no install and no boot.
if [ "$RUN_INSTALL" = "0" ] && [ "$RUN_RESTART" = "0" ]; then
  SCRATCH=$(mktemp -d); trap 'rm -rf "$SCRATCH"' EXIT
  run_soak
  echo "PASS: agent-teams templates + hooks (soak)"
  exit 0
fi

# ── hermetic dashboard ─────────────────────────────────────────────────────────
do_init agent-teams-templates 18970
do_banner
do_install
do_config_port

FAUX_DIR="$PREFIX/.pi/agent/extensions/faux-provider"
TEAMS_DIR="$PREFIX/.pi/agent/teams"
if [ "$RUN_RESTART" = "1" ]; then
  mkdir -p "$FAUX_DIR" "$TEAMS_DIR"
  cp "$FIXTURE_DIR/faux-provider.ext.ts" "$FAUX_DIR/index.ts"
  cp "$FIXTURE_DIR/faux-scenarios.ts" "$FAUX_DIR/faux-scenarios.ts"
fi

do_boot || do_fail "/api/health never answered 200 on :$PORT"
PLUGIN_ID="agent-teams"
API_PATH="/api/plugins/$PLUGIN_ID"

# ── install (#I2) ──────────────────────────────────────────────────────────────
expect_route() {  # <METHOD> <path> <body|-> <status> <json error code>
  local method="$1" path="$2" body="$3" status="$4" code="$5" out got
  if [ "$body" = "-" ]; then out=$(api "$method" "$API_PATH$path"); else out=$(api "$method" "$API_PATH$path" "$body"); fi
  got=$(api_code)
  [ "$got" = "$status" ] || do_fail "$method $path answered $got, expected $status (body: $out)"
  [ "$(printf '%s' "$out" | jx 'j.error')" = "$code" ] || do_fail "$method $path answered {error:$(printf '%s' "$out" | jx 'j.error')}, expected $code — is the route registered? (body: $out)"
}

plugin_manifest_json() {
  BIN_DIR="$BIN_DIR" node -e '
    const fs = require("fs"), path = require("path");
    let dir = path.dirname(fs.realpathSync(path.join(process.env.BIN_DIR, "pi-dashboard")));
    const roots = [];
    for (let d = dir; d !== path.dirname(d); d = path.dirname(d)) roots.push(d);
    for (const d of roots) {
      for (const p of [path.join(d, "node_modules/@blackbelt-technology/pi-dashboard-agent-teams-plugin"), path.join(d, "@blackbelt-technology/pi-dashboard-agent-teams-plugin"), path.join(d, "packages/agent-teams-plugin")]) {
        if (fs.existsSync(path.join(p, "package.json"))) { process.stdout.write(JSON.stringify({ dir: p, pkg: JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8")) })); process.exit(0); }
      }
    }
    process.exit(5);'
}

run_install() {
  echo "--- install (#I2): plugin load, routes, claims, optional dependency ---"
  wait_until 60 "the $PLUGIN_ID plugin row to report loaded" row_has "$PLUGIN_ID" 'r.status && r.status.loaded===true && !r.status.error'
  echo "row: loaded:true, no error"

  expect_route GET "/templates" - 400 cwd_required
  expect_route GET "/teams/qa-none/plans" - 404 not_found
  expect_route POST "/teams/start" '{}' 400 cwd_required
  expect_route POST "/teams/qa-none/members/x/plan-decision" '{}' 404 not_found
  expect_route POST "/hook-trust" '{}' 400 cwd_required
  expect_route DELETE "/hook-trust" - 400 cwd_required
  echo "routes: the six templates-hooks routes answer their own JSON errors"

  local found claims
  found=$(plugin_manifest_json) || do_fail "the installed agent-teams plugin package.json could not be located"
  claims=$(printf '%s' "$found" | jx 'JSON.stringify(((j.pkg["pi-dashboard-plugin"]||{}).claims||[]).map(c=>c.slot))')
  [ "$(printf '%s' "$claims" | jx 'j.filter(s=>s==="sidebar-folder-section").length')" = "1" ] || do_fail "manifest lacks exactly one sidebar-folder-section claim: $claims"
  [ "$(printf '%s' "$claims" | jx 'j.filter(s=>s==="custom-entry-renderer").length >= 5')" = "true" ] || do_fail "manifest lacks the custom-entry-renderer claims (core cards + approval + playbook): $claims"
  [ "$(printf '%s' "$claims" | jx 'j.includes("automation-action-editor")')" = "false" ] || do_fail "manifest claims automation-action-editor (deferred, D9): $claims"
  echo "manifest: sidebar-folder-section ×1, custom-entry-renderer claims present, no automation claim"

  # A missing optional dependency may take the PLUGIN down, never the host. Only meaningful when `yaml` is the
  # plugin's own copy; a hoisted `yaml` is the host's too, so removing it would test a different thing.
  local plugin_dir yaml_dir
  plugin_dir=$(printf '%s' "$found" | jx 'j.dir')
  yaml_dir=$(node -e 'try{process.stdout.write(require("path").dirname(require.resolve("yaml/package.json",{paths:[process.argv[1]]})))}catch{}' "$plugin_dir")
  case "$yaml_dir" in
    "$plugin_dir"/node_modules/*)
      local pid_before; pid_before=$(health_field pid)
      mv "$yaml_dir" "$yaml_dir.qa-off"
      do_restart
      [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" = "200" ] || { mv "$yaml_dir.qa-off" "$yaml_dir"; do_fail "the host did not survive a missing yaml (health != 200)"; }
      local row; row=$(plugin_row "$PLUGIN_ID")
      echo "row without yaml: $(printf '%s' "$row" | jx 'JSON.stringify({loaded:j.status&&j.status.loaded,error:j.status&&j.status.error})')"
      mv "$yaml_dir.qa-off" "$yaml_dir"
      do_restart
      wait_until 60 "the plugin to load again with yaml restored" row_has "$PLUGIN_ID" 'r.status && r.status.loaded===true && !r.status.error'
      echo "optional dependency: host stayed up without yaml (pid $pid_before -> restarted twice), plugin reloads with it" ;;
    *) echo "NOTE: yaml resolves to ${yaml_dir:-nothing} (shared with the host, not a private plugin copy): missing-dependency probe skipped" ;;
  esac
  echo "PASS (#I2): plugin install/load + registration checklist"
}

# ── restart (#D12) ─────────────────────────────────────────────────────────────
run_restart() {
  echo "--- restart (#D12): real server restart mid-team and at starting ---"
  cat > "$TEAMS_DIR/qa-squad.md" <<'MD'
---
name: qa-squad
description: QA squad with a blocking TaskCreated hook
spawn: eager
lead: { model: "faux/faux-1" }
notify: { coalesceMs: 500 }
members:
  - { name: alice, model: "faux/faux-1" }
  - { name: bob, model: "faux/faux-1" }
hooks:
  TaskCreated: [{ command: "echo qa-gate >&2; exit 2" }]
---
QA playbook for {{goal}}.
MD
  export QA_BASE="$BASE" QA_TEAMS_DIR="$TEAMS_DIR" QA_PORT_NODE="$PORT"
  PATH="$BIN_DIR:$PATH" HOME="$PREFIX" node -e '
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.QA_BASE;
const TIMEOUT_MS = 120000;
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function finish(code, msg) {
  console.log(msg);
  for (const p of procs) { try { p.kill("SIGKILL"); } catch {} }
  process.exit(code);
}
const fail = (m) => finish(1, "FAIL: " + m);

// `pi-dashboard api` mints local proof; HOME/PATH of this process already point at the hermetic prefix.
function api(method, p, data) {
  const out = execFileSync("pi-dashboard", ["api", method, p, "--port", process.env.QA_PORT_NODE, ...(data ? ["--data", JSON.stringify(data)] : [])], { encoding: "utf8" });
  const j = JSON.parse(out);
  return j && typeof j === "object" && "success" in j && "data" in j ? j.data : j;
}
async function waitFor(pred, what, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const v = await pred(); if (v) return v; } catch (e) { last = e; }
    await sleep(500);
  }
  fail("timed out waiting for " + what + (last ? " (last error: " + last.message + ")" : ""));
}
const mkDir = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-tpl-" + label + "-")));
const sessionsIn = (cwd) => (api("GET", "/api/sessions") || []).filter((s) => s.cwd === cwd && s.status !== "ended");
function launchPi(cwd) {
  const child = spawn("pi", ["--mode", "rpc", "--model", "faux/faux-1"], { cwd, env: { ...process.env, FAUX_SCRIPT: "plain-text" }, stdio: ["pipe", "ignore", "inherit"] });
  child.on("error", (e) => fail("pi spawn error: " + e.message));
  procs.push(child);
  return { prompt: (message) => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n") };
}
const TEAMS = "/api/plugins/agent-teams/teams";
const teamOf = (cwd) => {
  for (const t of api("GET", TEAMS).teams || []) {
    const snap = api("GET", TEAMS + "/" + t.id);
    if (snap.leadCwd === cwd) return snap;
  }
  return undefined;
};
const snapOf = (id) => api("GET", TEAMS + "/" + id);
const names = (snap) => (snap.members || []).map((m) => m.name).sort();
const pidOf = async () => (await (await fetch(BASE + "/api/health")).json()).pid;
async function restartServer() {
  const before = await pidOf();
  try { api("POST", "/api/restart"); } catch { /* the socket drops mid-response */ }
  await waitFor(async () => (await pidOf()) !== before, "a new server process");
}

async function midRun() {
  const cwd = mkDir("mid");
  const lead = launchPi(cwd);
  await waitFor(() => sessionsIn(cwd)[0], "the lead session to register");
  // The goal carries the faux sentinel: the spawned members (and the playbook turn) answer plain text.
  lead.prompt("/agent-team start qa-squad [[faux:plain-text]] qa run");
  const team = await waitFor(() => { const t = teamOf(cwd); return t && names(t).join() === "alice,bob" && t.members.every((m) => m.status === "idle") ? t : undefined; }, "the team with two idle eager members");
  lead.prompt("[[faux:agent-teams-lead-task]] go");
  await waitFor(() => (snapOf(team.id).stats || {}).hook_blocks >= 1, "the TaskCreated hook to block the lead task");
  const before = snapOf(team.id);
  if (before.tasks.length !== 0) fail("D12: the blocked TaskCreate left a task behind: " + JSON.stringify(before.tasks));

  // The template FILE loses its hook: only the snapshot may keep gating the running team.
  const file = path.join(process.env.QA_TEAMS_DIR, "qa-squad.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/hooks:\n  TaskCreated:.*\n/, ""));
  await restartServer();
  const after = await waitFor(() => { const t = snapOf(team.id); return t.status === "active" && t.leadConnected && t.members.every((m) => m.status !== "disconnected" && m.status !== "spawning") ? t : undefined; }, "the restarted server to re-bind the team");
  if (names(after).join() !== "alice,bob") fail("D12: members after the restart are " + names(after).join() + " (duplicated or lost)");
  if (after.tasks.length !== before.tasks.length) fail("D12: tasks changed across the restart");
  const ids = after.mail.map((m) => m.id);
  if (new Set(ids).size !== ids.length) fail("D12: duplicate mail ids after the restart");
  if (after.mail.some((m) => m.kind === "playbook")) fail("D12: a command-path team received a playbook mail after the restart");
  const live = sessionsIn(cwd).length;
  if (live !== 3) fail("D12: expected lead + 2 members (3 sessions) in the folder, found " + live + " (eager members spawned again?)");
  lead.prompt("[[faux:agent-teams-lead-task]] go");
  await waitFor(() => (snapOf(team.id).stats || {}).hook_blocks >= 1, "the frozen hook to block after the restart although the file no longer has it");
  if (snapOf(team.id).tasks.length !== 0) fail("D12: a task was created after the restart: the frozen hook did not gate it");
  console.log("OK D12 (A): same team, members " + names(after).join("+") + " once each, tasks unchanged, the frozen hook still blocks after the file lost it");
}

async function atStarting() {
  const cwd = mkDir("starting");
  launchPi(cwd); // a session in the folder makes it a known folder for the REST admission
  await waitFor(() => sessionsIn(cwd)[0], "the folder session to register");
  const started = api("POST", TEAMS + "/start", { template: "qa-squad", goal: "[[faux:plain-text]] qa starting", cwd });
  if (!started.teamId) fail("D12: POST teams/start returned no teamId: " + JSON.stringify(started));
  const first = snapOf(started.teamId).status;
  await restartServer(); // immediately: the lead has (almost certainly) not bound yet
  const settled = await waitFor(() => {
    const t = snapOf(started.teamId);
    if (t.status === "closed") return t;
    return t.status === "active" && t.members.length >= 2 ? t : undefined;
  }, "the team to leave `starting` (active with its roster, or closed)", 150000);
  if (settled.status === "closed") {
    if (settled.closeReason !== "lead_spawn_failed") fail("D12: the team closed with " + settled.closeReason + ", expected lead_spawn_failed");
    console.log("OK D12 (B): restart at " + first + " -> closed lead_spawn_failed (the deadline outcome), no slot held");
    return;
  }
  if (names(settled).join() !== "alice,bob") fail("D12: roster after the restart: " + names(settled).join());
  await sleep(5000);
  const final = snapOf(started.teamId);
  const playbooks = final.mail.filter((m) => m.kind === "playbook").length;
  if (playbooks !== 1) fail("D12: expected exactly one playbook mail, found " + playbooks);
  if (names(final).join() !== "alice,bob" || final.members.length !== 2) fail("D12: duplicate eager members: " + final.members.map((m) => m.name).join());
  console.log("OK D12 (B): restart at " + first + " -> active, roster spawned once, one playbook mail");
}

(async () => {
  await midRun();
  await atStarting();
  finish(0, "ALL OK");
})().catch((e) => fail(e && e.message ? e.message : String(e)));
' || do_fail "restart section failed (see above)"
  echo "PASS (#D12): real server restart end to end"
}

[ "$RUN_INSTALL" = "1" ] && run_install
[ "$RUN_RESTART" = "1" ] && run_restart
[ "$RUN_SOAK" = "1" ] && run_soak

echo "PASS: agent-teams templates + hooks"
