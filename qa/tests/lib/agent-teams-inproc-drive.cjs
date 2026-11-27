"use strict";
/**
 * Shared Node driver of the in-process agent-teams L2 scripts (qa/tests/60-agent-teams-inproc-persistence.sh,
 * qa/tests/61-agent-teams-inproc-perf.sh). Lives in qa/tests/lib so run-test.sh uploads it with the scripts.
 *
 * Every session is a real `pi --mode rpc` on the faux model (no API key). The LEAD of an in-process team is launched with
 * the FAKE subagents extension (`-e qa/fixtures/fake-subagents.ext.ts`, opt-in, never installed) whose scripted children run
 * inside the lead process. Observation is the read-only REST snapshot `GET /api/plugins/agent-teams/teams[/:id]`,
 * `/api/sessions`, and the fake's own state file (`FAKE_SUBAGENTS_STATE_FILE`: the "upstream child list").
 * HOME and PATH of THIS process must already point at the hermetic prefix (`pi-dashboard api` mints local proof).
 * See change: add-agent-teams-in-process (test-plan S97-S106).
 */
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TEAMS = "/api/plugins/agent-teams/teams";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class QaFail extends Error {}
const fail = (m) => {
  throw new QaFail(m);
};

function createDrive({ port, base, fakeExt, timeoutMs = 120000 }) {
  const procs = [];
  const dirs = [];
  const sessionIds = new Set();

  // `pi-dashboard api` mints local proof; it prints `{success,data}` JSON and exits 1 on a non-2xx answer.
  function api(method, p, data) {
    const out = execFileSync("pi-dashboard", ["api", method, p, "--port", String(port), ...(data ? ["--data", JSON.stringify(data)] : [])], { encoding: "utf8" });
    const j = JSON.parse(out);
    return j && typeof j === "object" && "success" in j && "data" in j ? j.data : j;
  }

  async function waitFor(pred, what, ms = timeoutMs, pollMs = 500) {
    const deadline = Date.now() + ms;
    let last;
    while (Date.now() < deadline) {
      try {
        const v = await pred();
        if (v) return v;
      } catch (e) {
        last = e; // the server may be mid-restart
      }
      await sleep(pollMs);
    }
    return fail(`timed out waiting for ${what}${last ? ` (last error: ${last.message})` : ""}`);
  }

  const mkDir = (label) => {
    const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `agent-teams-inproc-${label}-`)));
    dirs.push(d);
    return d;
  };
  const sessionsIn = (cwd) => (api("GET", "/api/sessions") || []).filter((s) => s.cwd === cwd && s.status !== "ended");
  const snapOf = (id) => api("GET", `${TEAMS}/${id}`);
  const names = (snap) => (snap.members || []).map((m) => m.name).sort();
  const memberOf = (snap, name) => (snap.members || []).find((m) => m.name === name);
  const pidOf = async () => (await (await fetch(`${base}/api/health`)).json()).pid;

  /** The newest team whose lead ran in `cwd` (closed ones only with `includeClosed`). */
  function teamOf(cwd, includeClosed = false) {
    const found = [];
    for (const t of api("GET", TEAMS).teams || []) {
      const snap = snapOf(t.id);
      if (snap.leadCwd === cwd && (includeClosed || snap.status !== "closed")) found.push(snap);
    }
    return found.sort((a, b) => b.createdAt - a.createdAt)[0];
  }

  /**
   * A real faux-model pi in `cwd`, driven over RPC. `fake` loads the fake subagents extension (`-e`, this lead only);
   * `env` carries the FAKE_SUBAGENTS_* knobs. Its stdout (the RPC event stream) is kept for tool-result assertions.
   */
  function launchPi(cwd, { fake = false, env = {} } = {}) {
    const args = ["--mode", "rpc", "--model", "faux/faux-1", ...(fake ? ["-e", fakeExt] : [])];
    const child = spawn("pi", args, { cwd, env: { ...process.env, FAUX_SCRIPT: "plain-text", ...env }, stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => {
      out = (out + d).slice(-2_000_000);
    });
    child.on("error", (e) => {
      console.log(`FAIL: pi spawn error: ${e.message}`);
      process.exit(1);
    });
    procs.push(child);
    return {
      child,
      pid: child.pid,
      output: () => out,
      prompt: (message) => child.stdin.write(`${JSON.stringify({ type: "prompt", message })}\n`),
      kill: (sig = "SIGKILL") => {
        try {
          child.kill(sig);
        } catch {
          /* already gone */
        }
      },
    };
  }

  /** "Quiet": not streaming and no session activity for 3 s (an RPC prompt that lands while a turn runs is refused). */
  async function settleIdle(cwd, sessionId) {
    const read = () => sessionsIn(cwd).find((x) => x.id === sessionId);
    let since = Date.now();
    let last = read()?.lastActivityAt;
    await waitFor(() => {
      const s = read();
      if (!s) return false;
      if (s.status === "streaming" || s.lastActivityAt !== last) {
        last = s.lastActivityAt;
        since = Date.now();
        return false;
      }
      return Date.now() - since >= 3000;
    }, "the lead session to go quiet");
  }

  async function restartServer() {
    const before = await pidOf();
    try {
      api("POST", "/api/restart");
    } catch {
      /* the socket drops mid-response: the expected shape of a restart */
    }
    await waitFor(async () => (await pidOf()) !== before, "a new server process");
  }

  /**
   * The lead + an in-process team scenario (default `agent-teams-inproc-lead-spawn`: alice and bob): resolves once every
   * expected member is held by the server as `busy` with a `childAgentId` (their run length comes from
   * `fakeEnv.FAKE_SUBAGENTS_RUN_MS`). `fake:false` launches the lead WITHOUT the fake extension (the real upstream package).
   */
  async function startInprocTeam(label, fakeEnv, { scenario = "agent-teams-inproc-lead-spawn", members = ["alice", "bob"], fake = true } = {}) {
    const cwd = mkDir(label);
    const lead = launchPi(cwd, { fake, env: fakeEnv });
    const leadSession = await waitFor(() => sessionsIn(cwd)[0], "the lead session to register");
    sessionIds.add(leadSession.id);
    lead.prompt(`[[faux:${scenario}]] go`);
    const want = [...members].sort().join();
    const team = await waitFor(() => {
      const t = teamOf(cwd);
      return t && t.mode === "in-process" && names(t).join() === want && t.members.every((m) => m.childAgentId && m.status === "busy") ? t : undefined;
    }, `an in-process team with busy members ${want} that carry a childAgentId`);
    return { cwd, lead, leadId: leadSession.id, teamId: team.id, team };
  }

  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
  }

  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === "EPERM";
    }
  };

  /** Every transitive child process of `pid` (macOS and Linux `ps`). */
  function descendants(pid) {
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number))
      .filter((r) => r.length === 2 && !r.some(Number.isNaN));
    const out = [];
    const walk = (p) => {
      for (const [c, pp] of rows) {
        if (pp !== p || out.includes(c)) continue;
        out.push(c);
        walk(c);
      }
    };
    walk(pid);
    return out;
  }

  /** Kill every session this run created, then the leads it launched, and remove its directories. */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: independent best-effort teardown steps, each swallowed on its own.
  function cleanup() {
    try {
      for (const s of api("GET", "/api/sessions") || []) if (dirs.includes(s.cwd) && s.pid) process.kill(s.pid, "SIGKILL");
    } catch {
      /* the server is down or restarting: best effort */
    }
    for (const id of sessionIds) {
      try {
        api("POST", `/api/session/${id}/shutdown`);
      } catch {
        /* best effort */
      }
    }
    for (const p of procs) {
      try {
        p.kill("SIGKILL");
      } catch {
        /* gone */
      }
    }
    for (const d of dirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  return { api, waitFor, mkDir, sessionsIn, snapOf, names, memberOf, pidOf, teamOf, launchPi, settleIdle, restartServer, startInprocTeam, readJson, alive, descendants, cleanup, sessionIds };
}

/** Run `main(drive)`; print `FAIL: …` and exit 1 on a failed assertion or error, always clean up. */
async function run(drive, main) {
  let code = 0;
  try {
    await main(drive);
  } catch (e) {
    console.log(`FAIL: ${e?.message ? e.message : String(e)}`);
    code = 1;
  }
  drive.cleanup();
  process.exit(code);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

module.exports = { createDrive, run, fail, sleep, median, QaFail, TEAMS };
