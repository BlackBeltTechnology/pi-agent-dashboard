"use strict";
/**
 * Driver of qa/tests/61-agent-teams-inproc-perf.sh (test-plan #S97, #S98, #S100, #S101, tasks 13.1-13.4).
 *
 * Two modes, chosen by the shell script and printed on every section:
 *   upstream  QA_UPSTREAM=1: the REAL `pi-dashboard-subagents` package (>= 0.9.0) is registered in the hermetic prefix; the
 *             lead is launched WITHOUT the fake. Child boot cost, loader (lean) and per-child heap are real.
 *   fixture   the FAKE subagents extension (`-e`): proves the dashboard-side plumbing only (command channel, mapper, server
 *             mode, snapshot). It has no child boot cost, token use or per-child heap, so the rows say below what they
 *             still measure and what they cannot.
 * Ratchets (decision A12) are REPORT-ONLY until a baseline file exists (QA_INPROC_BASELINE_FILE); QA_INPROC_RECORD_BASELINE=<file>
 * writes the measured values as the first baseline.
 *
 * Env: QA_PORT_NODE, QA_BASE, QA_FAKE_EXT, QA_SCRATCH, QA_UPSTREAM, QA_INPROC_PERF_SECTIONS ("spawn memory lag starve"),
 *      QA_INPROC_SPAWN_N (10), QA_INPROC_MEM_BUSY_S (120), QA_INPROC_MAIL_BURSTS (3), QA_INPROC_LAG_S (120),
 *      QA_INPROC_LAG_HARD_MS (10000), QA_INPROC_BASELINE_FILE, QA_INPROC_RECORD_BASELINE.
 * See change: add-agent-teams-in-process.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createDrive, run, fail, sleep, median } = require("./agent-teams-inproc-drive.cjs");

const UPSTREAM = process.env.QA_UPSTREAM === "1";
const MODE = UPSTREAM ? "upstream" : "fixture";
const SCRATCH = process.env.QA_SCRATCH;
const SECTIONS = (process.env.QA_INPROC_PERF_SECTIONS || "spawn memory lag starve").split(/\s+/).filter(Boolean);
const d = createDrive({ port: process.env.QA_PORT_NODE, base: process.env.QA_BASE, fakeExt: process.env.QA_FAKE_EXT });
const stateFile = (label) => path.join(SCRATCH, `${label}.state.json`);
const MB = 1024 * 1024;
const measured = {};
const baseline = (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.QA_INPROC_BASELINE_FILE || "", "utf8"));
  } catch {
    return undefined;
  }
})();
const report = (line) => console.log(`REPORT ${line}`);

/** The lead's latest process metrics as the server holds them (heartbeat cadence). */
function metricsOf(cwd, id) {
  const s = d.sessionsIn(cwd).find((x) => x.id === id);
  return s?.processMetrics;
}
/** Wait for two heartbeats newer than now, return the later metrics (a fresh sample, not a cached one). */
async function freshMetrics(cwd, id) {
  const t0 = Date.now();
  return d.waitFor(() => {
    const m = metricsOf(cwd, id);
    return m && m.updatedAt > t0 + 1 ? m : undefined;
  }, "a fresh heartbeat with process metrics for the lead", 180000, 1000);
}
const slopePerMin = (xs) => {
  // least squares over [{t (ms), v}] -> value units per minute
  const n = xs.length;
  if (n < 3) return 0;
  const mt = xs.reduce((a, p) => a + p.t, 0) / n;
  const mv = xs.reduce((a, p) => a + p.v, 0) / n;
  const den = xs.reduce((a, p) => a + (p.t - mt) ** 2, 0);
  return den === 0 ? 0 : (xs.reduce((a, p) => a + (p.t - mt) * (p.v - mv), 0) / den) * 60000;
};

// ── #S97 (13.1): spawn -> started latency, in-process vs session in the same run ────────────────────────────────
async function spawnCycles(kind, lean) {
  const cwd = d.mkDir(`spawn-${kind}`);
  const lead = d.launchPi(cwd, { fake: kind === "inproc" && !UPSTREAM, env: { FAKE_SUBAGENTS_RUN_MS: "50" } });
  const session = await d.waitFor(() => d.sessionsIn(cwd)[0], `the ${kind} lead to register`);
  d.sessionIds.add(session.id);
  const n = Number(process.env.QA_INPROC_SPAWN_N || 10);
  const times = [];
  for (let i = 0; i < n; i++) {
    await d.settleIdle(cwd, session.id);
    const t0 = Date.now();
    lead.prompt(`[[faux:agent-teams-bench-cycle-${kind}]] go`);
    const tStarted = await d.waitFor(
      () => {
        const team = d.teamOf(cwd);
        const m = team && d.memberOf(team, "w");
        if (m?.sessionId) d.sessionIds.add(m.sessionId);
        return m && m.status !== "spawning" ? Date.now() : 0;
      },
      `member w of the ${kind} team to leave \`spawning\` (cycle ${i + 1})`,
      120000,
      100,
    );
    times.push(tStarted - t0);
    await d.settleIdle(cwd, session.id);
    lead.prompt("[[faux:agent-teams-bench-delete]] go");
    await d.waitFor(() => !d.teamOf(cwd), `the bench team to close (cycle ${i + 1})`);
  }
  lead.kill("SIGTERM");
  console.log(`  ${kind}${lean === undefined ? "" : ` lean=${lean}`}: ${times.join(", ")} ms (polled at 100 ms; includes the lead's faux turn)`);
  report(`S97 ${kind}${lean === undefined ? "" : ` lean=${lean}`} cold=${times[0]} warm_median=${median(times.slice(1))} median=${median(times)} ms`);
  return times;
}

async function spawn() {
  console.log(`S97 spawn->started latency [${MODE}]${UPSTREAM ? "" : ": FIXTURE = dashboard plumbing only (no child boot cost); the <=50 % bar below is a regression guard on the command channel, NOT the child-boot claim"}`);
  const sessionTimes = await spawnCycles("session");
  const arms = UPSTREAM ? [false, true] : [undefined];
  const medians = [];
  for (const lean of arms) {
    if (lean !== undefined) d.api("POST", "/api/config/plugins/agent-teams", { inProcessLeanChildren: lean });
    const t = await spawnCycles("inproc", lean);
    medians.push(median(t));
    const sm = median(sessionTimes);
    if (median(t) > 0.5 * sm) fail(`S97: in-process median ${median(t)} ms > 50 % of the session median ${sm} ms (lean=${lean})`);
  }
  if (UPSTREAM) {
    if (medians[1] > medians[0] * 1.1) fail(`S97: lean median ${medians[1]} ms > full median ${medians[0]} ms (10 % noise allowance)`);
    d.api("POST", "/api/config/plugins/agent-teams", { inProcessLeanChildren: false });
  } else {
    console.log("  SKIP lean in {false,true} arm: the fake has no child loader (needs the real package: QA_SUBAGENTS_PKG_DIR)");
  }
  measured.spawn = { sessionMedianMs: median(sessionTimes), inprocMedianMs: medians[0] };
  console.log(`OK S97 [${MODE}]: in-process median ${medians[0]} ms vs session median ${median(sessionTimes)} ms (<= 50 %)`);
}

// ── #S98 (13.2): per-child memory + bounded growth under mail cycles ───────────────────────────────────────────
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear soak scenario (baseline, busy phase, assertions); splitting would scatter the row.
async function memory() {
  console.log(`S98 per-child memory [${MODE}]${UPSTREAM ? "" : ": FIXTURE children carry no per-child heap, so the idle-child delta is a plumbing baseline only; the growth check is meaningful"}`);
  const file = stateFile("memory");
  const cwd = d.mkDir("memory");
  const lead = d.launchPi(cwd, { fake: !UPSTREAM, env: { FAKE_SUBAGENTS_RUN_MS: "3000", FAKE_SUBAGENTS_STATE_FILE: file, FAKE_SUBAGENTS_MAX_CONCURRENT: "4" } });
  const session = await d.waitFor(() => d.sessionsIn(cwd)[0], "the lead to register");
  d.sessionIds.add(session.id);
  const h0 = (await freshMetrics(cwd, session.id)).heapUsed;
  lead.prompt("[[faux:agent-teams-inproc-lead-spawn4]] go");
  const team = await d.waitFor(() => {
    const t = d.teamOf(cwd);
    return t && t.mode === "in-process" && t.members.length === 4 && t.members.every((m) => m.childAgentId && m.status === "idle") ? t : undefined;
  }, "four in-process members that settled idle", 180000);
  await d.settleIdle(cwd, session.id);
  const h4 = (await freshMetrics(cwd, session.id)).heapUsed;
  const perChildMb = (h4 - h0) / 4 / MB;
  report(`S98 heap_per_idle_child_mb=${perChildMb.toFixed(2)} (lead heapUsed ${(h0 / MB).toFixed(1)} -> ${(h4 / MB).toFixed(1)} MB with 4 idle children)`);
  measured.memory = { perChildHeapMB: Math.max(perChildMb, 0) };
  if (baseline?.memory && baseline.memory.perChildHeapMB > 0 && perChildMb > 1.5 * baseline.memory.perChildHeapMB) {
    fail(`S98: heap per idle child ${perChildMb.toFixed(2)} MB > 1.5x baseline ${baseline.memory.perChildHeapMB} MB`);
  }

  // Busy phase: mail bursts wake the children (steer -> run -> idle) for QA_INPROC_MEM_BUSY_S, heap sampled per heartbeat.
  const busyMs = Number(process.env.QA_INPROC_MEM_BUSY_S || 120) * 1000;
  const bursts = Number(process.env.QA_INPROC_MAIL_BURSTS || 3);
  const samples = [];
  const t0 = Date.now();
  let sent = 0;
  while (Date.now() - t0 < busyMs || sent < bursts) {
    await d.settleIdle(cwd, session.id);
    lead.prompt("[[faux:agent-teams-inproc-mail-burst]] go");
    sent++;
    const m = metricsOf(cwd, session.id);
    if (m) samples.push({ t: Date.now() - t0, v: m.heapUsed / MB });
    if (Date.now() - t0 > busyMs * 3) fail("S98: the mail bursts did not finish in time");
  }
  await d.settleIdle(cwd, session.id);
  const snap = d.snapOf(team.id);
  const slope = slopePerMin(samples.slice(Math.floor(samples.length / 3)));
  report(`S98 lead_heap_slope_mb_per_min=${slope.toFixed(2)} over ${samples.length} samples, ${sent} bursts x 20 mails`);
  measured.memory.heapSlopeMBPerMin = slope;
  if (snap.status !== "active") fail(`S98: the team is ${snap.status} after the mail bursts`);
  if (snap.mail.length > 100) fail(`S98: snapshot mail list is unbounded (${snap.mail.length} > SNAPSHOT_MAIL_LIMIT 100)`);
  if (!(snap.mailTotal > 20)) fail(`S98: the mail bursts produced no mail (mailTotal ${snap.mailTotal}): the cycles did not run`);
  for (const k of ["inproc_unknown_event", "inproc_queue_overflow", "inproc_delivery_timeout"]) if (snap.stats?.[k]) fail(`S98: counter ${k} = ${snap.stats[k]}`);
  if (baseline && baseline.memory && baseline.memory.heapSlopeMBPerMin !== undefined && slope > Math.max(1.5 * baseline.memory.heapSlopeMBPerMin, 1)) {
    fail(`S98: heap slope ${slope.toFixed(2)} MB/min > 1.5x baseline ${baseline.memory.heapSlopeMBPerMin}`);
  }
  if (!UPSTREAM) {
    const state = d.readJson(file);
    if (!state || (state.events["subagents:started"] || 0) < 8) fail(`S98: the children were not woken by the mail bursts: ${JSON.stringify(state?.events)}`);
  }
  console.log(`OK S98 [${MODE}]: team active, mail bounded (${snap.mail.length}/${snap.mailTotal}), no unknown/overflow/timeout counters; baselines ${baseline ? "compared" : "report-only (no QA_INPROC_BASELINE_FILE)"}. Registry/outbox/ledger/cmdId map sizes are internal: bounded at L1 (inproc-host / driver tests), not observable here.`);
  lead.kill("SIGTERM");
}

// ── #S100 (13.3): event-loop lag in the shared process ─────────────────────────────────────────────────────────
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear soak scenario (sample, assert, report); splitting would scatter the row.
async function lag() {
  console.log(`S100 event-loop lag [${MODE}]${UPSTREAM ? "" : ": FIXTURE children stream progress events (no model streaming); the probe measures the lead loop under the bridge host's event mapping"}`);
  const file = stateFile("lag");
  const ctx = await d.startInprocTeam(
    "lag",
    { FAKE_SUBAGENTS_RUN_MS: "600000", FAKE_SUBAGENTS_PROGRESS_MS: "50", FAKE_SUBAGENTS_LAG_PROBE_MS: "100", FAKE_SUBAGENTS_STATE_FILE: file, FAKE_SUBAGENTS_MAX_CONCURRENT: "4" },
    { scenario: "agent-teams-inproc-lead-spawn4", members: ["alice", "bob", "carol", "dave"], fake: !UPSTREAM },
  );
  const lagS = Number(process.env.QA_INPROC_LAG_S || 120);
  let eventLoopMaxMs = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < lagS * 1000) {
    await sleep(5000);
    const t = d.snapOf(ctx.teamId);
    if (t.status !== "active" || !t.leadConnected || t.closeReason) fail(`S100: spurious lead end: team ${t.status} closeReason=${t.closeReason} leadConnected=${t.leadConnected}`);
    const m = metricsOf(ctx.cwd, ctx.leadId);
    if (m && typeof m.eventLoopMaxMs === "number") eventLoopMaxMs = Math.max(eventLoopMaxMs, m.eventLoopMaxMs);
  }
  const state = d.readJson(file);
  const hard = Number(process.env.QA_INPROC_LAG_HARD_MS || 10000);
  const maxGap = state?.loop ? state.loop.maxGapMs : undefined;
  report(`S100 heartbeat_eventLoopMaxMs=${eventLoopMaxMs}${maxGap !== undefined ? ` probe_max_gap_ms=${maxGap} ticks=${state.loop.ticks}` : " (no fake probe in upstream mode)"}`);
  measured.lag = { eventLoopMaxMs, ...(maxGap !== undefined ? { probeMaxGapMs: maxGap } : {}) };
  if (eventLoopMaxMs > hard || (maxGap !== undefined && maxGap > hard)) fail(`S100: event-loop stall ${Math.max(eventLoopMaxMs, maxGap || 0)} ms > hard ceiling ${hard} ms`);
  if (baseline && baseline.lag && baseline.lag.eventLoopMaxMs !== undefined && eventLoopMaxMs > 2 * Math.max(baseline.lag.eventLoopMaxMs, 50)) fail(`S100: eventLoopMaxMs ${eventLoopMaxMs} > 2x baseline ${baseline.lag.eventLoopMaxMs}`);
  console.log(`OK S100 [${MODE}]: 4 busy children for ${lagS} s, 0 spurious lead_ended; max loop gap ${maxGap ?? "n/a"} ms / heartbeat max ${eventLoopMaxMs} ms (report-only below the hard ceiling until a baseline exists)`);
}

// ── #S101 (13.4): shared crash/CPU domain — a child blocks the lead loop for 2x the heartbeat grace ──────────────
async function starve() {
  if (UPSTREAM) {
    console.log("SKIP S101 [upstream]: needs a scripted child tool handler that blocks the lead event loop; only the fake provides `[[fake-block:<ms>]]` (run it without QA_SUBAGENTS_PKG_DIR)");
    return;
  }
  console.log("S101 shared crash/CPU domain [fixture]: the lead loop is blocked 400 s (> 2x the 180 s bridge heartbeat timeout) by a fake child");
  const file = stateFile("starve");
  const ctx = await d.startInprocTeam("starve", { FAKE_SUBAGENTS_RUN_MS: "600000", FAKE_SUBAGENTS_STATE_FILE: file });
  await d.settleIdle(ctx.cwd, ctx.leadId);
  const t0 = Date.now();
  ctx.lead.prompt("[[faux:agent-teams-inproc-spawn-blocker]] go");
  const closed = await d.waitFor(
    () => {
      if (!d.alive(ctx.lead.pid)) fail("S101: the lead process died while its loop was blocked");
      const t = d.snapOf(ctx.teamId);
      return t.status === "closed" ? t : undefined;
    },
    "the team to close lead_ended after the heartbeat lapse",
    300000,
    5000,
  );
  const lapseS = Math.round((Date.now() - t0) / 1000);
  if (closed.closeReason !== "lead_ended") fail(`S101: closeReason is ${closed.closeReason}, expected lead_ended (documented outcome)`);
  // The lead's loop frees ~400 s after the block started; its next hello (same incarnation) delivers the queued best-effort stops.
  const state = await d.waitFor(
    () => {
      const s = d.readJson(file);
      return s && (s.events["subagents:started"] || 0) >= 3 && Object.keys(s.children).length === 0 ? s : undefined;
    },
    "the queued best-effort stops to reach the lead's children after its next hello (no child may keep running)",
    400000,
    5000,
  );
  if (!d.alive(ctx.lead.pid)) fail("S101: the lead process did not survive the lapse");
  console.log(`OK S101 [fixture]: team closed lead_ended after ${lapseS} s; lead pid ${ctx.lead.pid} survived; every child stopped after the next hello (${JSON.stringify(state.events)})`);
}

const TABLE = { spawn, memory, lag, starve };

run(d, async () => {
  for (const name of SECTIONS) {
    if (!TABLE[name]) fail(`unknown section ${name}`);
    console.log(`--- ${name} ---`);
    await TABLE[name]();
  }
  if (process.env.QA_INPROC_RECORD_BASELINE) {
    fs.writeFileSync(process.env.QA_INPROC_RECORD_BASELINE, `${JSON.stringify({ mode: MODE, ...measured }, null, 2)}\n`);
    console.log(`baseline recorded -> ${process.env.QA_INPROC_RECORD_BASELINE}`);
  }
  console.log("ALL OK");
});
