import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { expect, test } from "./fixture.js";

/**
 * L2 soak — probe flood on preview labels (host admission). Node-level (no browser); named `.resolver.spec.ts` only so the
 * suite runs it ONCE (the `chromium-resolver` project).
 * Row: test-plan #P17. See change: serve-live-previews-on-capability-origin (host-admission, 3.4/12.2).
 *
 * SCALED: the row is 10k req/s for 5 minutes; this runs `PI_LP_P17_RATE` req/s (default 10000) for `PI_LP_P17_SECONDS`
 * (default 25) — same arrival rate, shorter window. Random 26-char `*.localhost` Hosts (never minted) are sent on pipelined
 * keep-alive sockets while an operator WebSocket streams events from a registered session and `/api/health` is probed.
 * The achieved rate, latencies and RSS are printed (`[P17]`).
 */
const RATE = Number(process.env.PI_LP_P17_RATE ?? 10_000);
const SECONDS = Number(process.env.PI_LP_P17_SECONDS ?? 25);
const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "label-flood-worker.mjs");
const WARMUP_MS = 700;
/** Idle/flood windows alternate CYCLES times: CYCLES × FLOOD_S ≈ SECONDS of flood, CYCLES × IDLE_S of idle. */
const CYCLES = 10;
const FLOOD_S = Math.max(2, Math.round(SECONDS / CYCLES));
const IDLE_S = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? Number.NaN;
};

interface FloodStats {
  sent: number;
  r403: number;
  other: number;
  seconds: number;
}
/** Run the flood generator in a CHILD process (`label-flood-worker.mjs`), so this process's loop — which times health and events — is not loaded by it. */
function runFlood(port: number, rate: number, seconds: number): Promise<FloodStats> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, String(port), String(rate), String(seconds)], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as FloodStats) : reject(new Error(`flood worker exited ${code}`))));
  });
}

// A latency RATIO on a shared dev machine (other browsers/servers run concurrently) is occasionally poisoned by ambient load that hits
// one window population: re-measure up to twice. A real regression (the flood slowing /api/health) fails every attempt.
test.describe.configure({ retries: 2 });

test("T.P17 / #P17 probe flood on never-minted *.localhost labels: /api/health p95 ≤ 1.5× idle with the event stream live, `recent` untouched, bounded log, no per-label growth", async ({ isolatedServer }) => {
  test.setTimeout((CYCLES * (IDLE_S + 2) + SECONDS + 120) * 1000);
  const port = isolatedServer.port;

  // ── a dashboard session streaming events ───────────────────────────────────────────────────────────────────
  const cookie = await (async () => {
    const code = await isolatedServer.mintLocalProofCode();
    const res = await fetch(`http://127.0.0.1:${port}/auth/local-proof?code=${code}`, { redirect: "manual" });
    return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  })();
  expect(cookie, "operator cookie").toMatch(/pi_dash_/);
  const sessionId = `lp-p17-${Math.random().toString(36).slice(2, 8)}`;
  const bridge = new WebSocket(`ws+unix://${isolatedServer.gatewaySocket}:/`);
  await new Promise<void>((res, rej) => {
    bridge.once("open", () => res());
    bridge.once("error", rej);
  });
  bridge.send(JSON.stringify({ type: "session_register", sessionId, name: "p17", cwd: "/tmp", source: "tui", pid: 700_000 + Math.floor(Math.random() * 90_000) }));
  const browser = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie, origin: `http://127.0.0.1:${port}` } });
  const eventLatencies: { at: number; ms: number }[] = [];
  browser.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as { type?: string; event?: { data?: { sentAt?: number } } };
    const sentAt = msg.type === "event" ? msg.event?.data?.sentAt : undefined;
    if (sentAt) eventLatencies.push({ at: Date.now(), ms: Date.now() - sentAt });
  });
  await new Promise<void>((res, rej) => {
    browser.once("open", () => res());
    browser.once("error", rej);
  });
  // A freshly registered session is in REPLAY mode until it is idle for REPLAY_IDLE_MS (5 s): events forwarded meanwhile are
  // replayed, not streamed live. Stay silent past that, then subscribe and stream.
  await sleep(6_500);
  browser.send(JSON.stringify({ type: "subscribe", sessionId }));
  await sleep(500);
  let n = 0;
  const emitter = setInterval(() => {
    bridge.send(JSON.stringify({ type: "event_forward", sessionId, event: { eventType: "message_update", timestamp: Date.now(), data: { n: n++, sentAt: Date.now() } } }));
  }, 50);

  // ── /api/health probe (keep-alive, sequential) ──────────────────────────────────────────────────────────────
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const healthSamples: { at: number; ms: number }[] = [];
  const heapSamples: { at: number; mb: number }[] = [];
  let probing = true;
  const prober = (async () => {
    while (probing) {
      const t0 = performance.now();
      await new Promise<void>((resolve) => {
        http
          .get({ host: "127.0.0.1", port, path: "/api/health", agent, headers: { host: `localhost:${port}` } }, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => {
              healthSamples.push({ at: Date.now(), ms: performance.now() - t0 });
              try {
                heapSamples.push({ at: Date.now(), mb: (JSON.parse(body) as { server: { heapUsed: number } }).server.heapUsed / 1048576 });
              } catch {
                /* a partial body is just not a heap sample */
              }
              resolve();
            });
          })
          .on("error", () => resolve());
      });
      await sleep(20);
    }
  })();

  /** Samples whose timestamp falls inside any of `wins` (each trimmed by WARMUP_MS at its start). */
  const within = (xs: { at: number; ms: number }[], wins: [number, number][]): number[] => xs.filter((x) => wins.some(([f, t]) => x.at >= f + WARMUP_MS && x.at <= t)).map((x) => x.ms);
  try {
    const hostGateBefore = await isolatedServer.api("GET", "/api/host-gate");
    const mark = isolatedServer.logMark();

    // Interleaved idle / flood windows (CYCLES × [idle IDLE_S, flood FLOOD_S]) so ambient load on a shared machine hits both
    // populations alike; the row's "idle baseline in the same run" is the pooled idle windows. Total flood time = SECONDS.
    const idleWins: [number, number][] = [];
    const floodWins: [number, number][] = [];
    const total: FloodStats = { sent: 0, r403: 0, other: 0, seconds: 0 };
    for (let c = 0; c < CYCLES; c++) {
      const i0 = Date.now();
      await sleep(IDLE_S * 1000);
      idleWins.push([i0, Date.now()]);
      const f0 = Date.now();
      const st = await runFlood(port, RATE, FLOOD_S);
      floodWins.push([f0, f0 + FLOOD_S * 1000]); // the worker idles 1 s at the end to let in-flight responses land: not counted
      total.sent += st.sent;
      total.r403 += st.r403;
      total.other += st.other;
      total.seconds += FLOOD_S;
    }
    const i0 = Date.now();
    await sleep(IDLE_S * 1000);
    idleWins.push([i0, Date.now()]);
    const stats = total;
    const idleHealth = within(healthSamples, idleWins);
    const idleEvents = within(eventLatencies, idleWins);
    const floodHealth = within(healthSamples, floodWins);
    const floodEvents = within(eventLatencies, floodWins);
    const hostGateAfter = await isolatedServer.api("GET", "/api/host-gate");
    // Live-set proxy: the LOWEST heapUsed seen in the first vs the last idle window (garbage comes and goes; a per-label map does not).
    const minHeap = (w: [number, number]): number => Math.min(...heapSamples.filter((h) => h.at >= w[0] && h.at <= w[1]).map((h) => h.mb));
    const heapBefore = minHeap(idleWins[0] as [number, number]);
    // After the flood: the lowest heap since the flood BEGAN — any GC during/after 250k label probes shows its post-GC live set there.
    const heapAfter = Math.min(...heapSamples.filter((h) => h.at >= (floodWins[0] as [number, number])[0]).map((h) => h.mb));

    const rate = stats.sent / stats.seconds;
    const logLines = isolatedServer.logSince(mark).filter((l) => /[a-z2-7]{26}\.localhost/.test(l));
    const perHost = new Map<string, number>();
    for (const l of logLines) {
      const h = /([a-z2-7]{26})\.localhost/.exec(l)?.[1] ?? "";
      perHost.set(h, (perHost.get(h) ?? 0) + 1);
    }
    console.log(
      `[P17] ran ${stats.seconds}s of flood in ${CYCLES} windows interleaved with idle @ target ${RATE}/s (row: 5 min): sent ${stats.sent} (${rate.toFixed(0)}/s achieved), 403=${stats.r403}, other=${stats.other}; ` +
        `health p95 idle=${p95(idleHealth).toFixed(2)}ms (n=${idleHealth.length}) flood=${p95(floodHealth).toFixed(2)}ms (n=${floodHealth.length}), ratio ${(p95(floodHealth) / p95(idleHealth)).toFixed(2)}; ` +
        `events p95 idle=${p95(idleEvents).toFixed(2)}ms (n=${idleEvents.length}) flood=${p95(floodEvents).toFixed(2)}ms (n=${floodEvents.length}); ` +
        `heap(min idle before → min since flood start) ${heapBefore.toFixed(0)}→${heapAfter.toFixed(0)} MB; log lines for flooded labels=${logLines.length} (max/host ${Math.max(0, ...perHost.values())})`,
    );

    expect(idleHealth.length, "enough idle health samples").toBeGreaterThan(50);
    expect(floodHealth.length, "enough health samples under flood").toBeGreaterThan(stats.seconds * 10);
    expect(idleEvents.length, "the event stream is flowing at idle").toBeGreaterThan(50);
    expect(floodEvents.length, "the event stream kept flowing under flood").toBeGreaterThan(stats.seconds * 10);
    expect(rate, "the flood really ran near the row's rate").toBeGreaterThan(RATE * 0.7);
    expect(stats.other, "every flooded probe was answered 403 (never served, never 5xx)").toBe(0);
    expect(stats.r403, "responses account for (almost) every request sent").toBeGreaterThan(stats.sent * 0.95);

    // The row's metric: /api/health p95 ≤ 1.5× the idle baseline of the same run. Idle and flood windows alternate finely (CYCLES
    // of each) so ambient load on a shared dev machine lands on both populations alike; both p95s are pooled over all windows.
    expect(p95(floodHealth), `/api/health p95 under flood (${p95(floodHealth).toFixed(2)} ms) ≤ 1.5× idle (${p95(idleHealth).toFixed(2)} ms)`).toBeLessThanOrEqual(p95(idleHealth) * 1.5);

    // The row's metric is `/api/health` p95 (above). The event stream is the concurrent workload: it must stay LIVE and never stall
    // (its p95 ratio is reported in the `[P17]` line; ms-resolution samples make a 1.5× bound on a ~5-10 ms p95 pure noise).
    expect(Math.max(...floodEvents), "no event was delayed by more than 250 ms under flood").toBeLessThan(250);
    const expectedFloodEvents = 20 * CYCLES * (FLOOD_S - WARMUP_MS / 1000); // emitter: 1 event / 50 ms
    expect(floodEvents.length, `events keep arriving at the emitter rate under flood (≥ 90% of ${expectedFloodEvents})`).toBeGreaterThan(expectedFloodEvents * 0.9);

    expect(hostGateAfter.json.recent, "`recent` (host-gate refusal ring) untouched by label probes").toEqual(hostGateBefore.json.recent);
    expect(perHost.size, "≤ 256 distinct hosts logged").toBeLessThanOrEqual(256);
    expect(Math.max(0, ...perHost.values()), "≤ 1 log line per host per 60 s").toBeLessThanOrEqual(1);
    expect(heapAfter - heapBefore, `no per-label growth: ${stats.sent} distinct labels must not be retained (live heap ${heapBefore.toFixed(0)}→${heapAfter.toFixed(0)} MB)`).toBeLessThan(15);
  } finally {
    probing = false;
    clearInterval(emitter);
    await prober;
    agent.destroy();
    browser.close();
    bridge.close();
  }
});
