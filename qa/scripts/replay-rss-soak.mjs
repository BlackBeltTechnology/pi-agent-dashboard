#!/usr/bin/env node
/**
 * P4 (L2) — replay RSS soak. Change: compact-warm-replay-stream (#399).
 *
 * Repeats N cold subscribes (`lastSeq: 0` → full replay) against a RUNNING
 * dashboard and samples the server's RSS from `/api/health` (`server.rss`),
 * asserting it returns to within a tolerance of the pre-test baseline. Guards
 * the "compaction allocates a second array per replay" concern: a leak would
 * show as monotonically climbing RSS across iterations.
 *
 * This is an ON-DEMAND probe, not a CI gate — RSS is noisy (GC timing, other
 * sessions), so a threshold tight enough to catch a real leak would flake in
 * the shared suite.
 *
 * Usage (against the docker harness):
 *   docker/test-up.sh -d                       # writes .pi-test-harness.json
 *   node qa/scripts/replay-rss-soak.mjs [--iterations 10] [--tolerance 0.10]
 *   docker/test-down.sh
 *
 * Port resolution: --port, else PW_E2E_PORT, else `dashboardPort` from
 * .pi-test-harness.json. Never hardcodes 18000.
 */
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function resolvePort() {
  const explicit = arg("port", process.env.PW_E2E_PORT);
  if (explicit) return Number(explicit);
  const stateFile = path.resolve(import.meta.dirname, "../../.pi-test-harness.json");
  if (fs.existsSync(stateFile)) {
    const port = Number(JSON.parse(fs.readFileSync(stateFile, "utf8")).dashboardPort);
    if (Number.isInteger(port) && port > 0) return port;
  }
  throw new Error("No port: pass --port, set PW_E2E_PORT, or run docker/test-up.sh first.");
}

/** `Number()` yields NaN/Infinity for junk, which would silently disable the
 *  verdict (`settled > NaN` is false ⇒ always PASS). Fail loud instead. */
function num(name, fallback, { min, max }) {
  const v = Number(arg(name, fallback));
  if (!Number.isFinite(v) || v < min || v > max) {
    console.error(`--${name} must be a finite number in [${min}, ${max}] (got ${arg(name, fallback)})`);
    process.exit(2);
  }
  return v;
}

const PORT = resolvePort();
const ITERATIONS = num("iterations", 10, { min: 1, max: 1000 });
const TOLERANCE = num("tolerance", 0.1, { min: 0, max: 100 });
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (b) => (b / 1_048_576).toFixed(1);

async function health() {
  const res = await fetch(`${BASE}/api/health`);
  if (!res.ok) throw new Error(`/api/health -> HTTP ${res.status}`);
  return res.json();
}

/**
 * Pick the heaviest replay target: the session with the most events when the
 * server reports a count, else the first listed. Fails fast on an empty list or
 * an entry without an id, instead of hanging until the 20s timeout.
 */
async function pickSessionId() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error("timed out listing sessions")); }, 20_000);
    const done = (fn, arg) => { clearTimeout(timer); ws.close(); fn(arg); };
    ws.on("open", () => ws.send(JSON.stringify({ type: "list_sessions" })));
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const list = msg?.sessions ?? msg?.data?.sessions;
      if (!Array.isArray(list)) return; // not the reply we are waiting for
      if (list.length === 0) {
        done(reject, new Error("no sessions on the dashboard — spawn one before soaking"));
        return;
      }
      const countOf = (s) =>
        [s?.eventCount, s?.entryCount].find((n) => typeof n === "number") ?? -1;
      const heaviest = list.reduce((best, s) => (countOf(s) > countOf(best) ? s : best), list[0]);
      const id = heaviest?.id ?? heaviest?.sessionId;
      if (typeof id !== "string" || id.length === 0) {
        done(reject, new Error(`session entry has no id: ${JSON.stringify(heaviest).slice(0, 120)}`));
        return;
      }
      done(resolve, id);
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

/** One cold subscribe: connect, subscribe from seq 0, drain until isLast. */
function coldSubscribe(sessionId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    let events = 0;
    const timer = setTimeout(() => { ws.close(); reject(new Error("replay timed out")); }, 60_000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "subscribe", sessionId, lastSeq: 0 })));
    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type !== "event_replay") return;
      events += msg.events?.length ?? 0;
      if (msg.isLast) { clearTimeout(timer); ws.close(); resolve(events); }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const sessionId = await pickSessionId();
console.log(`session: ${sessionId}\nport: ${PORT}  iterations: ${ITERATIONS}  tolerance: +${TOLERANCE * 100}%`);

await sleep(2_000);
const baseline = (await health()).server.rss;
console.log(`baseline RSS: ${mb(baseline)} MB`);

const samples = [];
for (let i = 1; i <= ITERATIONS; i++) {
  const events = await coldSubscribe(sessionId);
  const rss = (await health()).server.rss;
  samples.push(rss);
  console.log(`  ${String(i).padStart(2)}: replayed ${String(events).padStart(6)} events  RSS ${mb(rss)} MB`);
}

// Let GC settle before the verdict — a transient peak is not a leak.
console.log("settling 30s for GC…");
await sleep(30_000);
const settled = (await health()).server.rss;

const ceiling = baseline * (1 + TOLERANCE);
console.log(`\nsettled RSS: ${mb(settled)} MB   ceiling: ${mb(ceiling)} MB (baseline +${TOLERANCE * 100}%)`);
console.log(`peak during soak: ${mb(Math.max(...samples))} MB`);

if (settled > ceiling) {
  console.error("FAIL — RSS did not return within tolerance; investigate a replay-path leak.");
  process.exit(1);
}
console.log("PASS — RSS returned within tolerance of baseline.");
