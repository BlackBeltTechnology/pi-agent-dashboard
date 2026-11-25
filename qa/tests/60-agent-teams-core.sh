#!/usr/bin/env bash
# Test: agent-teams core — restart mid-team, lead resume (L2).
# See change: add-agent-teams-core (test-plan S76, S85; S87 is NOT covered, see below).
#
#   S76  runtime: hello after restart — real server restart mid-team: the lead and
#        the teammate bridges reconnect ⇒ member status == reported idle state, no
#        mail duplicated (every mail id unique + acked, one `task_assigned`), 0
#        duplicate claims, tasks unchanged.
#   S85  runtime: lead resume — the lead pi killed and resumed from its session
#        file (`--session <lead id>`, same id) ⇒ team orphaned → active, the lead tool set
#        is back (TaskCreate works) and dispatch resumes; a DIFFERENT id (fresh pi
#        in the same cwd) leaves the team orphaned.
#   S87  (task 14.3, session replaced via `/new`) is not driven here: the dashboard
#        `/new` prompt SPAWNS a separate session (command-handler `spawnNew`) and does
#        not replace the teammate process, and a server-spawned teammate has no
#        stdin to send the RPC `new_session` to. Needs a tmux/TUI-driven check.
#
# Every session is a real `pi --mode rpc` on the faux model (no API key). The lead
# is driven over RPC (`qa/fixtures/faux-scenarios.ts`: agent-teams-lead-spawn /
# agent-teams-lead-task); the teammate is spawned by the dashboard server itself,
# so the faux fixture is staged as a GLOBAL pi extension for the run (as the
# docker harness does). Observation is the read-only REST snapshot
# `GET /api/plugins/agent-teams/teams[/:id]` and `/api/sessions`.
# SKIPs (SKIP: first line + exit 0) when pi is absent or the plugin is not loaded.
set -euo pipefail

if ! command -v pi >/dev/null 2>&1; then
  echo "SKIP: pi not on PATH (agent-teams core smoke requires pi installed)"
  exit 0
fi

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURE_DIR="$REPO_ROOT/qa/fixtures"

if [ ! -f "$FIXTURE_DIR/faux-provider.ext.ts" ]; then
  echo "FAIL: fixture not found at $FIXTURE_DIR/faux-provider.ext.ts"
  exit 1
fi

# Ensure the dashboard server is up (started by an earlier test, else start it).
STARTED_SERVER=0
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  pi-dashboard start >/dev/null 2>&1 &
  STARTED_SERVER=1
  ELAPSED=0
  while [ $ELAPSED -lt 15 ]; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/health 2>/dev/null || echo "000")
    [ "$HTTP_CODE" = "200" ] && break
    sleep 1; ELAPSED=$((ELAPSED + 1))
  done
fi

# Stage the faux fixture as a global extension so dashboard-spawned teammates have the model too.
FAUX_EXT_DIR="$HOME/.pi/agent/extensions/faux-provider"
STAGED_FAUX=0
cleanup() {
  [ "$STAGED_FAUX" = "1" ] && rm -rf "$FAUX_EXT_DIR" || true
  [ "$STARTED_SERVER" = "1" ] && pi-dashboard stop 2>/dev/null || true
}
trap cleanup EXIT

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: dashboard server not reachable (health=$HTTP_CODE)"
  exit 1
fi

# The plugin may not be loaded on this server (opt-out, untrusted, older build): SKIP, never red-fail.
PROBE=$(pi-dashboard api GET /api/plugins/agent-teams/teams 2>/dev/null || true)
if ! echo "$PROBE" | grep -q '"teams"'; then
  echo "SKIP: agent-teams plugin routes not available on this dashboard server"
  exit 0
fi

if [ ! -f "$FAUX_EXT_DIR/index.ts" ]; then
  mkdir -p "$FAUX_EXT_DIR"
  cp "$FIXTURE_DIR/faux-provider.ext.ts" "$FAUX_EXT_DIR/index.ts"
  cp "$FIXTURE_DIR/faux-scenarios.ts" "$FAUX_EXT_DIR/faux-scenarios.ts"
  STAGED_FAUX=1
fi

echo "=== Test: agent-teams core (restart mid-team, lead resume) ==="

# Node owns the drive + polling. Run from the repo so any `require` resolves against its node_modules.
cd "$REPO_ROOT"
node -e '
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TIMEOUT_MS = 90000;
const procs = [];
const sessionsToStop = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(code, msg) {
  console.log(msg);
  for (const p of procs) { try { p.kill("SIGKILL"); } catch {} }
  for (const id of sessionsToStop) {
    try { execFileSync("pi-dashboard", ["api", "POST", "/api/session/" + id + "/shutdown"], { stdio: "ignore" }); } catch {}
  }
  process.exit(code);
}
const fail = (m) => finish(1, "FAIL: " + m);

// `pi-dashboard api` mints local proof (the strict `requireLocalProof` default refuses a bare request).
function api(method, p, data) {
  const out = execFileSync("pi-dashboard", ["api", method, p, ...(data ? ["--data", JSON.stringify(data)] : [])], { encoding: "utf8" });
  const j = JSON.parse(out);
  return j && typeof j === "object" && "success" in j && "data" in j ? j.data : j;
}
async function waitFor(pred, what, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const v = await pred(); if (v) return v; } catch (e) { last = e; } // server may be mid-restart
    await sleep(500);
  }
  fail("timed out waiting for " + what + (last ? " (last error: " + last.message + ")" : ""));
}

const mkHome = (label) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-" + label + "-")));
const sessionsIn = (cwd) => (api("GET", "/api/sessions") || []).filter((s) => s.cwd === cwd && s.status !== "ended");

/** A real faux-model pi in `cwd`, driven over RPC (the global faux extension supplies the model). */
function launchPi(cwd, extraArgs = []) {
  const child = spawn("pi", ["--mode", "rpc", "--model", "faux/faux-1", ...extraArgs], {
    cwd,
    // Keep the real HOME: the bridge resolves the dashboard endpoint from the HOME-derived rendezvous record.
    env: { ...process.env, FAUX_SCRIPT: "plain-text" },
    stdio: ["pipe", "ignore", "inherit"],
  });
  child.on("error", (e) => fail("pi spawn error: " + e.message));
  procs.push(child);
  return {
    child,
    prompt: (message) => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n"),
    // SIGTERM lets pi unregister (explicit end) so the team orphans at once; a SIGKILLed
    // session would linger until the 180 s heartbeat timeout. SIGKILL only as the backstop.
    kill: () => {
      try { child.kill("SIGTERM"); } catch {}
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
      t.unref();
    },
  };
}

const teamOf = (cwd) => {
  const list = api("GET", "/api/plugins/agent-teams/teams").teams || [];
  for (const t of list) {
    const snap = api("GET", "/api/plugins/agent-teams/teams/" + t.id);
    if (snap.leadCwd === cwd && snap.status !== "closed") return snap;
  }
  return undefined;
};
const snapOf = (id) => api("GET", "/api/plugins/agent-teams/teams/" + id);
const alice = (snap) => (snap.members || []).find((m) => m.name === "alice");

/** Lead pi + `agent-teams-lead-spawn`: resolves once alice is an idle member. */
async function setupTeam(label) {
  const cwd = mkHome(label);
  const lead = launchPi(cwd);
  const leadSession = await waitFor(() => sessionsIn(cwd)[0], "the lead session to register");
  lead.prompt("[[faux:agent-teams-lead-spawn]] go");
  const team = await waitFor(() => { const t = teamOf(cwd); return t && alice(t) && alice(t).status === "idle" ? t : undefined; }, "the team with an idle teammate alice");
  if (alice(team).sessionId) sessionsToStop.add(alice(team).sessionId);
  return { cwd, lead, leadId: leadSession.id, teamId: team.id };
}

/** A task for the dispatcher: alice claims it (owner alice, in_progress) and is idle again after her turn. */
async function giveAliceATask(ctx) {
  ctx.lead.prompt("[[faux:agent-teams-lead-task]] go");
  await waitFor(() => { const t = snapOf(ctx.teamId); return t.tasks.some((x) => x.owner === "alice" && x.status === "in_progress") ? t : undefined; }, "alice to claim the task");
  return waitFor(() => { const t = snapOf(ctx.teamId); return alice(t).status === "idle" ? t : undefined; }, "alice to settle idle");
}

const pidOf = async () => { const r = await fetch("http://localhost:8000/api/health"); return (await r.json()).pid; };
const taskKey = (t) => t.id + ":" + t.status + ":" + (t.owner || "");

async function s76() {
  const ctx = await setupTeam("restart");
  const before = await giveAliceATask(ctx);
  const assignedBefore = before.mail.filter((m) => m.kind === "task_assigned" && m.to === "alice").length;
  if (assignedBefore !== 1) fail("S76: expected one task_assigned before the restart, got " + assignedBefore);
  const pidBefore = await pidOf();
  try { api("POST", "/api/restart"); } catch { /* the socket drops mid-response: the expected shape of a restart */ }
  await waitFor(async () => (await pidOf()) !== pidBefore, "a new server process");
  const after = await waitFor(() => {
    const t = snapOf(ctx.teamId);
    const a = alice(t);
    return t.status === "active" && t.leadConnected && a && a.status !== "disconnected" && a.status !== "spawning" ? t : undefined;
  }, "the restarted server to re-bind lead and teammate");
  if (alice(after).status !== "idle") fail("S76: alice reports idle but the server says " + alice(after).status);
  if (after.tasks.map(taskKey).join() !== before.tasks.map(taskKey).join()) fail("S76: tasks changed across the restart: " + JSON.stringify(after.tasks.map(taskKey)));
  const assignedAfter = after.mail.filter((m) => m.kind === "task_assigned" && m.to === "alice").length;
  if (assignedAfter !== assignedBefore) fail("S76: task_assigned mails went " + assignedBefore + " -> " + assignedAfter + " (duplicate claim or redelivery)");
  const ids = after.mail.map((m) => m.id);
  if (new Set(ids).size !== ids.length) fail("S76: duplicate mail ids after restart");
  if (after.mail.some((m) => m.to === "alice" && m.ackedAt === undefined)) fail("S76: unacked mail left for alice after the restart");
  console.log("OK S76: restart mid-team re-bound lead + teammate; tasks unchanged; no duplicate mail or claim");
}

async function s85() {
  const ctx = await setupTeam("resume");
  ctx.lead.kill();
  await waitFor(() => snapOf(ctx.teamId).status === "orphaned", "the team to be orphaned after the lead died");
  const resumed = launchPi(ctx.cwd, ["--session", ctx.leadId]); // the lead session file by id (continue would pick the newest one in this cwd: alice) ⇒ same session id
  await waitFor(() => { const t = snapOf(ctx.teamId); return t.status === "active" && t.leadConnected ? t : undefined; }, "the team to be active again after the lead resumed");
  // Proves the lead tool set is back. A prompt that lands before the resumed bridge has activated the
  // lead tools cannot create the task, so re-send it a few times (each success only adds a task).
  let claimed = false;
  for (let attempt = 0; attempt < 4 && !claimed; attempt++) {
    resumed.prompt("[[faux:agent-teams-lead-task]] go");
    const until = Date.now() + 15000;
    while (!claimed && Date.now() < until) {
      try { claimed = snapOf(ctx.teamId).tasks.some((x) => x.owner === "alice"); } catch {}
      if (!claimed) await sleep(500);
    }
  }
  if (!claimed) fail("timed out waiting for dispatch to resume (alice claims the new task)");
  // A different id (a fresh pi in the same cwd, no --continue) must not take the lead role.
  resumed.kill();
  await waitFor(() => snapOf(ctx.teamId).status === "orphaned", "the team to be orphaned again");
  const stranger = launchPi(ctx.cwd);
  await waitFor(() => sessionsIn(ctx.cwd).length > 0, "the fresh session to register");
  await sleep(5000);
  const t = snapOf(ctx.teamId);
  stranger.kill();
  if (t.status !== "orphaned") fail("S85: a different session id took over the team (status " + t.status + ")");
  console.log("OK S85: same-id resume re-activates the team and dispatch; a different id leaves it orphaned");
}

(async () => {
  await s76();
  await s85();
  finish(0, "ALL OK");
})().catch((e) => fail(e && e.message ? e.message : String(e)));
'

echo "PASS: agent-teams core (S76, S85)"
