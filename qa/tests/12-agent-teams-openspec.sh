#!/usr/bin/env bash
# Test: agent-teams OpenSpec profiles (openspec-group / openspec-apply) — process-level smoke (L2).
# See change: add-agent-teams-openspec (test-plan #V1 = 10.4, #V2 = 10.5, #V3 = 10.6).
#
#   v1  (#V1)  bundled source on a clean install: `GET …/teams/templates?cwd=` of a TRUSTED project lists BOTH bundled
#              templates (source `bundled`, one entry each) and no `judo-modules`; starting `openspec-group` (and
#              `openspec-apply`) in an UNTRUSTED project answers `project_untrusted`; nothing is created under
#              `.worktrees/` and no team exists afterwards.
#   v2  (#V2)  loopback inject on a real server (hardened `requireLocalProof` default): (A) a group start makes the
#              launcher create the worktree at the EXPLICIT path `<repo>/.worktrees/os-<change>` on branch `os/<change>`
#              through `POST /api/git/worktree`; failures are typed in the sidecar (`worktree_path_unexpected` for a
#              symlink in the way, a route/git code for a branch checked out elsewhere); (B) an apply start: a scripted
#              implementer completes its task, the runtime ticks that ONE checkbox through `GET /api/openspec/tasks` +
#              `POST …/toggle` — `tasks.md` differs from the original in exactly that box, byte for byte.
#   v3  (#V3)  kill -9 mid-run: 3 changes, parallel 2, faux teammates whose "ship skill" is scripted
#              (`agent-teams-openspec-ship-<taskId>`: archive the change in its worktree, complete the task). The server
#              is SIGKILLed right after the FIRST launch record (a `post-checkout` hook keeps the `launching` window
#              open). After the restart: that launch is `launch_failed launch_interrupted`, reported to the lead ONCE
#              (also after a second restart), no worktree holds two sessions, the relaunch route clears it and the
#              change ships, every task ends completed and the sidecar is valid JSON.
#
# Hermetic: own prefix (HOME), own port (default 18980), the faux provider staged under the prefix and made the
# default model (members the launcher spawns carry no model of their own). Inputs are those of dist-only-lib.sh
# (QA_PREFIX, QA_BIN_DIR, QA_DASHBOARD_TARBALL, QA_EXTRA_TARBALLS, QA_PORT, ...) plus
#   QA_OPENSPEC_SECTIONS   space-separated subset of "v1 v2 v3" (default: all three)
#   QA_REPO_ROOT           checkout holding qa/fixtures (default: this repo)
# SKIPs (`SKIP:` first line + exit 0) without `pi` or git on PATH or without the faux fixtures.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${QA_REPO_ROOT:-$(cd "$HERE/../.." && pwd)}"
FIXTURE_DIR="$REPO_ROOT/qa/fixtures"
# shellcheck source=dist-only-lib.sh
. "$HERE/dist-only-lib.sh"

# Hermetic: a developer shell inside a pi session exports PI_DASHBOARD_SOCKET/URL/SESSION_ID..., which would make
# the faux pi sessions below register with THAT dashboard instead of the one under test.
for v in $(compgen -e | grep -E '^(PI_|DASHBOARD_STARTER$)' || true); do unset "$v"; done

SECTIONS="${QA_OPENSPEC_SECTIONS:-v1 v2 v3}"
want() { case " $SECTIONS " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

if ! command -v pi >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  echo "SKIP: needs pi and git on PATH (agent-teams openspec smoke)"
  exit 0
fi
if [ ! -f "$FIXTURE_DIR/faux-provider.ext.ts" ] || [ ! -f "$FIXTURE_DIR/faux-scenarios.ts" ]; then
  echo "SKIP: faux fixtures not found under $FIXTURE_DIR"
  exit 0
fi

echo "=== Test: agent-teams OpenSpec profiles (sections: $SECTIONS) ==="

# ── hermetic dashboard ─────────────────────────────────────────────────────────
do_init agent-teams-openspec 18980
do_banner
do_install
do_config_port

FAUX_DIR="$PREFIX/.pi/agent/extensions/faux-provider"
mkdir -p "$FAUX_DIR"
cp "$FIXTURE_DIR/faux-provider.ext.ts" "$FAUX_DIR/index.ts"
cp "$FIXTURE_DIR/faux-scenarios.ts" "$FAUX_DIR/faux-scenarios.ts"

# The launcher spawns members without a model: the faux model must be the default for pi (settings.json,
# split provider/model keys) and for the dashboard bridge (config.json defaultModel).
PREFIX="$PREFIX" node -e '
  const fs = require("fs"), path = require("path");
  const merge = (file, patch) => {
    let c = {}; try { c = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...c, ...patch }, null, 2) + "\n");
  };
  merge(path.join(process.env.PREFIX, ".pi/agent/settings.json"), { defaultProvider: "faux", defaultModel: "faux-1" });
  merge(path.join(process.env.PREFIX, ".pi/dashboard/config.json"), { defaultModel: "faux/faux-1" });'

do_boot || do_fail "/api/health never answered 200 on :$PORT"
export QA_PORT_NODE="$PORT"

# ── shared node library (REST through `pi-dashboard api`, faux pi sessions, repos, teams, sidecar) ──────────────
cat > "$SCRATCH/os-lib.cjs" <<'JS'
"use strict";
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = process.env.QA_PORT_NODE;
const BASE = "http://localhost:" + PORT;
const TEAMS = "/api/plugins/agent-teams";
const TIMEOUT_MS = 240000;
const procs = [];
const dirs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanEnv = () => { const e = { ...process.env }; delete e.JITI_TSCONFIG_PATHS; return e; };

// `pi-dashboard api` mints local proof (the strict `requireLocalProof` default refuses a bare request). It exits 0
// on 2xx (body on stdout) and 1 otherwise (body on stderr).
function apiTry(method, p, data) {
  const r = spawnSync("pi-dashboard", ["api", method, p, "--port", PORT, ...(data !== undefined ? ["--data", JSON.stringify(data)] : [])], { encoding: "utf8", env: cleanEnv() });
  const raw = ((r.status === 0 ? r.stdout : r.stderr || r.stdout) || "").trim();
  let body;
  try { body = JSON.parse(raw); } catch { try { body = JSON.parse(raw.slice(raw.indexOf("{"))); } catch { body = undefined; } }
  return { ok: r.status === 0, code: r.status, raw, body };
}
function api(method, p, data) {
  const r = apiTry(method, p, data);
  if (!r.ok) throw new Error(method + " " + p + " failed: " + r.raw.slice(0, 300));
  const j = r.body;
  return j && typeof j === "object" && "success" in j && "data" in j ? j.data : j;
}

function finish(code, msg) {
  console.log(msg);
  // Teammates are spawned by the server, not by us: kill every session under our dirs, then the leads we launched.
  try {
    for (const s of api("GET", "/api/sessions") || []) {
      if (s.pid && dirs.some((d) => s.cwd === d || String(s.cwd).startsWith(d + path.sep))) { try { process.kill(s.pid, "SIGKILL"); } catch {} }
    }
  } catch { /* the server is down or restarting: best effort */ }
  for (const p of procs) { try { p.kill("SIGKILL"); } catch {} }
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  process.exit(code);
}
const fail = (m) => finish(1, "FAIL: " + m);

async function waitFor(pred, what, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const v = await pred(); if (v) return v; } catch (e) { last = e; } // the server may be mid-restart
    await sleep(500);
  }
  return fail("timed out waiting for " + what + (last ? " (last error: " + last.message + ")" : ""));
}

// ── repositories ──────────────────────────────────────────────────────────────
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=qa", "-c", "user.email=qa@localhost", ...args], { cwd, encoding: "utf8" }).trim();
function mkDir(label) { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "os-qa-" + label + "-"))); dirs.push(d); return d; }
/** A real repository whose default branch is `develop` (the launcher forks worktrees from it). */
function mkRepo(label) {
  const d = mkDir(label);
  git(d, "init", "-q", "-b", "develop");
  fs.writeFileSync(path.join(d, "README.md"), "qa\n");
  git(d, "add", "-A");
  git(d, "commit", "-q", "-m", "init");
  return d;
}
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
/** groups.json + one change per entry + stand-in ship/review skills + a hook-free `.pi/settings.json`, committed on develop. */
function seed(repo, groupId, changes) {
  const names = changes.map((c) => c.name);
  write(path.join(repo, "openspec/groups/groups.json"), JSON.stringify({ schemaVersion: 1, groups: [{ id: groupId, name: groupId }], assignments: Object.fromEntries(names.map((n) => [n, groupId])), changeOrder: { [groupId]: names } }, null, 2) + "\n");
  for (const c of changes) {
    write(path.join(repo, "openspec/changes", c.name, "tasks.md"), c.tasks || "## 1. Work\n\n- [ ] 1.1 Do " + c.name + "\n");
    write(path.join(repo, "openspec/changes", c.name, "proposal.md"), "## Why\n\nqa change " + c.name + "\n");
  }
  // A committed `.pi/settings.json` WITHOUT `worktreeInit`: the server's project auto-seed writes a stack-detected
  // init hook into any known project that has none, and that hook is untrusted ⇒ every launch fails `init_untrusted`.
  write(path.join(repo, ".pi/settings.json"), "{}\n");
  for (const skill of ["ship-it", "review-code"]) write(path.join(repo, ".pi/skills", skill, "SKILL.md"), "---\nname: " + skill + "\ndescription: qa stand-in for " + skill + "\n---\n\nStand-in skill.\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "seed");
}
/** pi records a trust decision per folder; the recorded entry decides first (true OR false). */
function setTrust(dir, value) {
  const f = path.join(os.homedir(), ".pi", "agent", "trust.json");
  let d = {};
  try { d = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  d[dir] = value;
  write(f, JSON.stringify(d, null, 2) + "\n");
}

// ── sessions, teams, sidecar ──────────────────────────────────────────────────
const sessionsIn = (cwd) => (api("GET", "/api/sessions") || []).filter((s) => s.cwd === cwd && s.status !== "ended");
/** A real faux-model pi in `cwd`, driven over RPC (the staged faux extension supplies the model). */
function launchPi(cwd) {
  const child = spawn("pi", ["--mode", "rpc", "--model", "faux/faux-1"], { cwd, env: { ...process.env, FAUX_SCRIPT: "plain-text" }, stdio: ["pipe", "ignore", "inherit"] });
  child.on("error", (e) => fail("pi spawn error: " + e.message));
  procs.push(child);
  return { prompt: (message) => child.stdin.write(JSON.stringify({ type: "prompt", message }) + "\n") };
}
const snapOf = (id) => api("GET", TEAMS + "/teams/" + id);
const teamOf = (cwd) => {
  for (const t of api("GET", TEAMS + "/teams").teams || []) {
    const s = snapOf(t.id);
    if (s.leadCwd === cwd && s.status !== "closed") return s;
  }
  return undefined;
};
/** Start a profile team the command way (this pi is the lead) and wait until it is seeded with `tasks` tasks. */
async function startProfile(lead, cwd, template, goal, tasks) {
  lead.prompt("/agent-team start " + template + " " + goal);
  return waitFor(() => { const t = teamOf(cwd); return t && t.tasks.length === tasks ? t : undefined; }, "the " + template + " team of " + goal + " to be seeded with " + tasks + " tasks");
}
function findSidecar(teamId) {
  const walk = (dir, depth) => {
    if (depth > 8) return undefined;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return undefined; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "sessions") continue;
        const hit = walk(p, depth + 1);
        if (hit) return hit;
      } else if (e.name === teamId + ".json" && path.basename(dir) === "openspec") return p;
    }
    return undefined;
  };
  return walk(path.join(os.homedir(), ".pi"), 0);
}
const readSidecar = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const recordOf = (sidecar, change) => Object.values(sidecar.launched || {}).find((r) => r.change === change);
const shutdownTeam = (id) => { try { api("POST", TEAMS + "/teams/" + id + "/shutdown"); } catch {} };

/** "Quiet": not streaming and no session activity for 3 s (a restored session reports `active`, not `idle`, until its next run boundary). */
async function settleIdle(cwd, sessionId) {
  const read = () => sessionsIn(cwd).find((x) => x.id === sessionId);
  let since = Date.now();
  let last = (read() || {}).lastActivityAt;
  await waitFor(async () => {
    const s = read();
    if (!s) return false;
    if (s.status === "streaming" || s.lastActivityAt !== last) { last = s.lastActivityAt; since = Date.now(); return false; }
    return Date.now() - since >= 3000;
  }, "session " + sessionId + " to go quiet");
}
const promptSession = (id, text) => api("POST", "/api/session/" + id + "/prompt", { text });
/** The teammate of `change` once it is launched, owns its task and is quiet. */
async function ownerOf(teamId, change) {
  const hit = await waitFor(() => {
    const s = snapOf(teamId);
    const task = s.tasks.find((x) => x.title === change);
    const member = task && (s.members || []).find((m) => m.name === task.owner);
    return task && member && member.sessionId && member.status === "idle" ? { task, member } : undefined;
  }, "the teammate of change " + change + " to be launched and idle");
  await settleIdle(hit.member.cwd, hit.member.sessionId);
  return hit;
}
/** Scripted ship: archive the change in its worktree and complete the task (the server's `not_shipped` gate verifies it). */
async function shipChange(teamId, change) {
  const { task, member } = await ownerOf(teamId, change);
  promptSession(member.sessionId, "[[faux:agent-teams-openspec-ship-" + task.id + "]] go");
  await waitFor(() => snapOf(teamId).tasks.find((x) => x.title === change && x.status === "completed"), "change " + change + " to ship (task completed)");
}
/** Every cwd under `<repo>/.worktrees` and how many live sessions it holds. */
function worktreeSessionCounts(repo) {
  const counts = {};
  for (const s of api("GET", "/api/sessions") || []) {
    if (s.status !== "ended" && String(s.cwd).startsWith(path.join(repo, ".worktrees") + path.sep)) counts[s.cwd] = (counts[s.cwd] || 0) + 1;
  }
  return counts;
}
function expectNoDuplicateSessions(repo, when) {
  for (const [cwd, n] of Object.entries(worktreeSessionCounts(repo))) if (n > 1) fail(when + ": " + n + " live sessions in the worktree " + cwd + " (duplicate launch)");
}

// ── server process ────────────────────────────────────────────────────────────
async function healthPid() {
  try {
    const r = await fetch(BASE + "/api/health", { signal: AbortSignal.timeout(3000) });
    return r.ok ? (await r.json()).pid ?? null : null;
  } catch { return null; }
}
const startServer = () => spawnSync("pi-dashboard", ["start", "--port", PORT, "--no-tunnel"], { env: cleanEnv(), stdio: "ignore" });
async function waitNewServer(oldPid) {
  const began = Date.now();
  let started = false;
  await waitFor(async () => {
    const pid = await healthPid();
    if (pid !== null && pid !== oldPid) return true;
    if (pid === null && !started && Date.now() - began > 10000) { started = true; startServer(); } // nothing supervised it back up
    return false;
  }, "a new server process", 150000);
}
async function restartServer() {
  const before = await healthPid();
  try { api("POST", "/api/restart"); } catch { /* the socket drops mid-response */ }
  await waitNewServer(before);
}

module.exports = { fs, os, path, TEAMS, sleep, api, apiTry, finish, fail, waitFor, git, mkDir, mkRepo, write, seed, setTrust, sessionsIn, launchPi, snapOf, teamOf, startProfile, findSidecar, readSidecar, recordOf, shutdownTeam, settleIdle, promptSession, ownerOf, shipChange, worktreeSessionCounts, expectNoDuplicateSessions, healthPid, startServer, waitNewServer, restartServer };
JS

run_node() {  # <script file> — the node program of one section (hermetic HOME, installed bin on PATH)
  PATH="$BIN_DIR:$PATH" HOME="$PREFIX" QA_LIB="$SCRATCH/os-lib.cjs" node "$1"
}

# ── v1 (#V1) ───────────────────────────────────────────────────────────────────
run_v1() {
  echo "--- v1 (#V1): bundled source listed; untrusted start refused; nothing under .worktrees ---"
  cat > "$SCRATCH/v1.cjs" <<'JS'
const L = require(process.env.QA_LIB);
const { fs, path } = L;
(async () => {
  const trusted = L.mkRepo("v1-trusted");
  const untrusted = L.mkRepo("v1-untrusted");
  L.setTrust(trusted, true);
  L.setTrust(untrusted, false);
  // A live session makes a folder a known folder for the REST admission.
  L.launchPi(trusted);
  L.launchPi(untrusted);
  await L.waitFor(() => L.sessionsIn(trusted)[0] && L.sessionsIn(untrusted)[0], "both folder sessions to register");

  const listing = L.api("GET", L.TEAMS + "/templates?cwd=" + encodeURIComponent(trusted));
  const templates = listing.templates || [];
  for (const name of ["openspec-group", "openspec-apply"]) {
    const hits = templates.filter((t) => t.name === name);
    if (hits.length !== 1) L.fail("V1: expected exactly one " + name + " template, got " + JSON.stringify(hits));
    if (hits[0].source !== "bundled") L.fail("V1: " + name + " has source " + hits[0].source + ", expected bundled");
    if (hits[0].valid === false) L.fail("V1: bundled template " + name + " is invalid: " + JSON.stringify(hits[0].errors));
  }
  if (templates.some((t) => t.name === "judo-modules")) L.fail("V1: judo-modules is listed (it must not ship bundled)");
  if (templates.some((t) => t.source === "bundled" && !["openspec-group", "openspec-apply"].includes(t.name))) L.fail("V1: unexpected bundled template: " + JSON.stringify(templates.filter((t) => t.source === "bundled").map((t) => t.name)));
  console.log("OK V1: both bundled templates listed (source bundled), no judo-modules");

  for (const [template, goal] of [["openspec-group", "v1-group"], ["openspec-apply", "v1-change"]]) {
    const r = L.apiTry("POST", L.TEAMS + "/teams/start", { template, goal, cwd: untrusted });
    if (r.ok) L.fail("V1: " + template + " started in an untrusted project: " + r.raw);
    if (!r.body || r.body.error !== "project_untrusted") L.fail("V1: " + template + " in an untrusted project answered " + r.raw + ", expected error project_untrusted");
  }
  if (L.teamOf(untrusted)) L.fail("V1: a team exists for the untrusted project");
  for (const dir of [trusted, untrusted]) if (fs.existsSync(path.join(dir, ".worktrees"))) L.fail("V1: " + dir + "/.worktrees exists (the preflight must create nothing)");
  console.log("OK V1: untrusted start -> project_untrusted for both profiles; no team, nothing under .worktrees");
  L.finish(0, "ALL OK v1");
})().catch((e) => L.fail(e && e.message ? e.message : String(e)));
JS
  run_node "$SCRATCH/v1.cjs" || do_fail "v1 failed (see above)"
  echo "PASS (#V1): bundled source + untrusted refusal"
}

# ── v2 (#V2) ───────────────────────────────────────────────────────────────────
run_v2() {
  echo "--- v2 (#V2): loopback inject — explicit-path worktree, typed failures, byte-exact checkbox toggle ---"
  cat > "$SCRATCH/v2.cjs" <<'JS'
const L = require(process.env.QA_LIB);
const { fs, os, path } = L;

/** (A) group: the launcher drives POST /api/git/worktree through host.localRequest. */
async function partA() {
  const repo = L.mkRepo("v2-group");
  L.seed(repo, "v2-group", [{ name: "v2-ok" }, { name: "v2-bad" }, { name: "v2-busy" }]);
  // v2-bad: a symlink sits where the worktree must go (refused before any route call).
  fs.mkdirSync(path.join(repo, ".worktrees"));
  fs.symlinkSync(os.tmpdir(), path.join(repo, ".worktrees", "os-v2-bad"));
  // v2-busy: its branch is checked out elsewhere (the git route itself refuses).
  const elsewhere = L.mkDir("v2-elsewhere");
  L.git(repo, "worktree", "add", "-q", "-b", "os/v2-busy", path.join(elsewhere, "wt"));
  L.setTrust(repo, true);

  const lead = L.launchPi(repo);
  await L.waitFor(() => L.sessionsIn(repo)[0], "the lead session to register");
  const team = await L.startProfile(lead, repo, "openspec-group", "v2-group", 3);
  const sidecarFile = await L.waitFor(() => L.findSidecar(team.id), "the sidecar of the team");

  // the first change: worktree at the explicit path, branch os/v2-ok, its teammate runs there
  const wt = path.join(repo, ".worktrees", "os-v2-ok");
  await L.waitFor(() => { const r = L.recordOf(L.readSidecar(sidecarFile), "v2-ok"); return r && r.state === "launched"; }, "v2-ok to be launched");
  const listed = L.git(repo, "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => fs.realpathSync(l.slice(9)));
  if (!listed.includes(fs.realpathSync(wt))) L.fail("V2: no registered worktree at the explicit path " + wt + " (got " + listed.join(", ") + ")");
  const branch = L.git(wt, "symbolic-ref", "--short", "HEAD");
  if (branch !== "os/v2-ok") L.fail("V2: worktree branch is " + branch + ", expected os/v2-ok");
  await L.waitFor(() => L.sessionsIn(wt).length === 1, "exactly one teammate session in " + wt);
  console.log("OK V2 (A): worktree at the explicit path " + wt + " on branch os/v2-ok, one teammate session");

  // typed failures
  await L.waitFor(() => { const d = L.readSidecar(sidecarFile); const a = L.recordOf(d, "v2-bad"); const b = L.recordOf(d, "v2-busy"); return a && b && a.state === "launch_failed" && b.state === "launch_failed"; }, "v2-bad and v2-busy to fail typed");
  const d = L.readSidecar(sidecarFile);
  const bad = L.recordOf(d, "v2-bad");
  const busy = L.recordOf(d, "v2-busy");
  if (bad.code !== "worktree_path_unexpected") L.fail("V2: v2-bad failed with " + bad.code + ", expected worktree_path_unexpected");
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(String(busy.code)) || busy.code === "unknown") L.fail("V2: v2-busy failure is not a typed token: " + busy.code);
  if (L.fs.existsSync(path.join(repo, ".worktrees", "os-v2-busy"))) L.fail("V2: a worktree was created for v2-busy although its branch is checked out elsewhere");
  console.log("OK V2 (A): failures typed — v2-bad " + bad.code + ", v2-busy " + busy.code);
  L.shutdownTeam(team.id);
}

/** (B) apply: a completed task ticks exactly its checkbox through GET /api/openspec/tasks + POST …/toggle. */
async function partB() {
  const repo = L.mkRepo("v2-apply");
  const original = "## 1. Build\n\n- [ ] 1.1 first box  \n- [ ] 1.2 second box — ünïcode\n- [ ] 1.3 third box\n\n## 2. Wrap up\n\n- [ ] 2.1 closing box\n";
  L.seed(repo, "v2-apply-group", [{ name: "v2-apply", tasks: original }]);
  L.setTrust(repo, true);
  const tasksFile = path.join(repo, "openspec/changes/v2-apply/tasks.md");
  const lead = L.launchPi(repo);
  await L.waitFor(() => L.sessionsIn(repo)[0], "the apply lead session to register");
  const team = await L.startProfile(lead, repo, "openspec-apply", "v2-apply", 5); // 4 boxes + Review
  const sidecarFile = await L.waitFor(() => L.findSidecar(team.id), "the apply sidecar");
  // the first unit: the lowest task id that carries a checkbox ref
  const refs = L.readSidecar(sidecarFile).refs;
  const taskId = Object.keys(refs).filter((id) => Array.isArray(refs[id].boxes)).sort((a, b) => Number(a) - Number(b))[0];
  if (!taskId) L.fail("V2: no checkbox-backed task in the apply sidecar: " + JSON.stringify(refs));
  const owner = await L.waitFor(() => {
    const s = L.snapOf(team.id);
    const t = s.tasks.find((x) => x.id === taskId);
    const m = t && (s.members || []).find((x) => x.name === t.owner);
    return t && m && m.sessionId && m.status === "idle" && t.status === "in_progress" ? m : undefined;
  }, "an implementer to own task " + taskId + " and be idle");
  await L.settleIdle(owner.cwd, owner.sessionId);
  L.promptSession(owner.sessionId, "[[faux:agent-teams-openspec-complete-" + taskId + "]] go");
  await L.waitFor(() => fs.readFileSync(tasksFile, "utf8") !== original, "the runtime to tick the checkbox in tasks.md");
  await L.waitFor(() => L.readSidecar(sidecarFile).synced[taskId] === true, "the sidecar to record task " + taskId + " as synced");

  const after = fs.readFileSync(tasksFile, "utf8");
  const a = original.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) L.fail("V2: tasks.md changed its line count " + a.length + " -> " + b.length);
  const changed = a.map((line, i) => (line === b[i] ? -1 : i)).filter((i) => i >= 0);
  if (changed.length !== 1) L.fail("V2: " + changed.length + " lines changed in tasks.md, expected exactly one: " + JSON.stringify(changed.map((i) => [a[i], b[i]])));
  const i = changed[0];
  if (a[i] !== "- [ ] 1.1 first box  " || b[i] !== "- [x] 1.1 first box  ") L.fail("V2: the toggle changed " + JSON.stringify(a[i]) + " into " + JSON.stringify(b[i]) + ", expected only the box of task " + taskId + " (1.1, trailing spaces kept)");
  const expected = original.replace("- [ ] 1.1 first box  ", "- [x] 1.1 first box  ");
  if (Buffer.compare(Buffer.from(after, "utf8"), Buffer.from(expected, "utf8")) !== 0) L.fail("V2: tasks.md is not byte-identical to the original with that one box ticked");
  console.log("OK V2 (B): task " + taskId + " completed -> exactly its checkbox ticked, rest of tasks.md byte-identical, synced:true");
  L.shutdownTeam(team.id);
}

(async () => {
  await partA();
  await partB();
  L.finish(0, "ALL OK v2");
})().catch((e) => L.fail(e && e.message ? e.message : String(e)));
JS
  run_node "$SCRATCH/v2.cjs" || do_fail "v2 failed (see above)"
  echo "PASS (#V2): loopback inject on a real server"
}

# ── v3 (#V3) ───────────────────────────────────────────────────────────────────
run_v3() {
  echo "--- v3 (#V3): SIGKILL after the first launch record; no duplicate launches; relaunch completes ---"
  cat > "$SCRATCH/v3.cjs" <<'JS'
const L = require(process.env.QA_LIB);
const { fs, path } = L;
const CHANGES = ["v3-alpha", "v3-beta", "v3-gamma"];

/** The sidecar directory `<dataDir>/openspec` (walk once it exists; `pi-dashboard api` calls take ~1 s, the kill must not wait for one). */
function findSidecarDir() {
  const walk = (dir, depth) => {
    if (depth > 8) return undefined;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return undefined; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === "sessions") continue;
      const p = path.join(dir, e.name);
      if (e.name === "openspec" && path.basename(dir) === "agent-teams") return p;
      const hit = walk(p, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(path.join(L.os.homedir(), ".pi"), 0);
}
/** Poll the sidecars (no REST) and SIGKILL the server at the first launch record of `repo`'s team. */
async function killAtFirstLaunchRecord(repo, pid) {
  const deadline = Date.now() + 240000;
  let dir;
  let walked = 0;
  while (Date.now() < deadline) {
    if (!dir && Date.now() - walked > 250) { walked = Date.now(); dir = findSidecarDir(); }
    if (dir) {
      try {
        for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
          let d;
          try { d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; } // a rename in flight
          if (d.repo === repo && Object.keys(d.launched || {}).length > 0) {
            process.kill(pid, "SIGKILL");
            return { file: path.join(dir, f), teamId: d.teamId, states: Object.values(d.launched).map((r) => r.state) };
          }
        }
      } catch { /* the directory is being created */ }
    }
    await L.sleep(10);
  }
  return L.fail("V3: no launch record appeared");
}
/** How often the lead was told that `change` was interrupted (a coalesced notice may carry several texts). */
function interruptedNotices(teamId, change) {
  const needle = 'launch of change "' + change + '" failed: launch_interrupted';
  return (L.snapOf(teamId).mail || []).reduce((n, m) => n + String(m.text).split(needle).length - 1, 0);
}

(async () => {
  const repo = L.mkRepo("v3");
  L.seed(repo, "v3-group", CHANGES.map((name) => ({ name })));
  L.setTrust(repo, true);
  // `git worktree add` runs post-checkout: the `launching` record stays open for seconds, so the kill lands inside it.
  const hook = path.join(repo, ".git", "hooks", "post-checkout");
  L.write(hook, "#!/bin/sh\nsleep 4\n");
  fs.chmodSync(hook, 0o755);

  const lead = L.launchPi(repo);
  await L.waitFor(() => L.sessionsIn(repo)[0], "the lead session to register");
  const serverPid = await L.healthPid();
  lead.prompt("/agent-team start openspec-group v3-group");
  const killed = await killAtFirstLaunchRecord(repo, serverPid);
  const sidecarFile = killed.file;
  const team = { id: killed.teamId };
  const seen = killed.states;
  const atKill = L.readSidecar(sidecarFile); // a SIGKILLed server wrote nothing since
  const interrupted = Object.values(atKill.launched).find((r) => r.state === "launching");
  if (!interrupted) L.fail("V3: the kill missed the launching window (states at the kill: " + seen.join(",") + "); the post-checkout hook did not hold it open");
  const change = interrupted.change;
  fs.rmSync(hook, { force: true }); // later launches (and the relaunch) must be quick
  L.startServer();
  await L.waitNewServer(serverPid);
  console.log("killed the server (pid " + serverPid + ") while " + change + " was launching; restarted");

  // the record becomes launch_failed launch_interrupted, nothing is relaunched automatically
  await L.waitFor(() => { const r = L.recordOf(L.readSidecar(sidecarFile), change); return r && r.state === "launch_failed" && r.code === "launch_interrupted"; }, change + " to become launch_failed launch_interrupted");
  await L.waitFor(() => interruptedNotices(team.id, change) >= 1, "the lead to be told about the interrupted launch");
  if (interruptedNotices(team.id, change) !== 1) L.fail("V3: launch_interrupted reported " + interruptedNotices(team.id, change) + " times after the first restart, expected once");
  L.expectNoDuplicateSessions(repo, "after the restart");

  // the other changes were launched by the restarted server: let their teammates register before the next restart
  // (a restart while a spawn is still unresolved fails that spawn by design and leaves its task pending)
  for (const c of CHANGES.filter((x) => x !== change)) await L.ownerOf(team.id, c);
  // a second restart must not repeat the notice (the `noticed` flag is persisted)
  await L.restartServer();
  await L.waitFor(() => { const t = L.snapOf(team.id); return t.status === "active" && t.leadConnected ? t : undefined; }, "the team to be re-bound after the second restart");
  await L.sleep(3000);
  if (interruptedNotices(team.id, change) !== 1) L.fail("V3: launch_interrupted reported " + interruptedNotices(team.id, change) + " times after the second restart, expected once");
  if (L.recordOf(L.readSidecar(sidecarFile), change).state !== "launch_failed") L.fail("V3: the interrupted launch was retried automatically");
  L.expectNoDuplicateSessions(repo, "after the second restart");
  console.log("OK V3: " + change + " -> launch_failed launch_interrupted, reported once across two restarts, no duplicate session");

  // relaunch through the route; the others ship first (parallel 2 frees a slot), then the relaunched change
  const relaunch = L.api("POST", L.TEAMS + "/openspec-relaunch", { teamId: team.id, change });
  if (!relaunch || relaunch.ok !== true || relaunch.change !== change) L.fail("V3: relaunch answered " + JSON.stringify(relaunch));
  for (const c of CHANGES.filter((x) => x !== change)) {
    await L.shipChange(team.id, c);
    L.expectNoDuplicateSessions(repo, "while shipping " + c);
  }
  await L.shipChange(team.id, change);
  await L.waitFor(() => L.snapOf(team.id).tasks.every((t) => t.status === "completed"), "every task to be completed");
  L.expectNoDuplicateSessions(repo, "at the end");

  const final = L.readSidecar(sidecarFile); // valid JSON or the parse throws
  if (final.schemaVersion !== 1 || Object.keys(final.launched).length !== 3) L.fail("V3: final sidecar is not the expected shape: " + JSON.stringify(final.launched));
  if (Object.values(final.launched).some((r) => r.state === "launching")) L.fail("V3: a launch record is still `launching`");
  if (interruptedNotices(team.id, change) !== 1) L.fail("V3: launch_interrupted reported " + interruptedNotices(team.id, change) + " times at the end");
  console.log("OK V3: relaunch via the route completed, 3/3 shipped, sidecar valid JSON");
  L.shutdownTeam(team.id);
  L.finish(0, "ALL OK v3");
})().catch((e) => L.fail(e && e.message ? e.message : String(e)));
JS
  run_node "$SCRATCH/v3.cjs" || do_fail "v3 failed (see above)"
  echo "PASS (#V3): kill -9 mid-run recovers without duplicate launches"
}

want v1 && run_v1
want v2 && run_v2
want v3 && run_v3

echo "PASS: agent-teams OpenSpec profiles"
