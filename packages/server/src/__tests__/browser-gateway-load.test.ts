/**
 * Browser-gateway broadcast LOAD harness — scenario matrix A–E.
 *
 * Drives the REAL `createBrowserGateway` + real `broadcastToAll` /
 * `broadcastOpenSpecUpdate` / backpressure-guard code against timing-aware
 * `DrainingFakeWs` sockets under a caller-owned virtual clock. Reproduces the
 * suspected head-of-line blocking where a focused-session live `event` waits
 * behind competing multi-cwd `openspec_update` traffic on the single shared
 * browser socket.
 *
 * These tests CHARACTERIZE current (cwd-keyed, unfiltered) fan-out behavior.
 * Each `// REGRESSION TARGET:` marks the value a future subscription-scoped
 * fan-out fix should achieve. Until that fix lands, the leak assertions
 * (`wastedBytes > 0`) document the bug rather than forbid it.
 *
 * See change: add-ws-broadcast-load-harness.
 */
import { describe, it, expect } from "vitest";
import {
  DRAIN_FAST,
  DRAIN_SLOW,
  seedSessions,
  buildLoadGateway,
  makeOpenSpecPayload,
  attachClients,
  subscribeWs,
} from "./helpers/load-fixtures.js";
import { createDrainingWs } from "./helpers/draining-ws.js";

// ── Budget constants ──────────────────────────────────────────────────────
// Upper bounds on focused-event flush latency (virtual ms). Generous because
// the model is illustrative, not calibrated (see DRAIN_FAST/DRAIN_SLOW).
const BUDGET_A_FLUSH_FAST_MS = 5; //    focused event alone, fast link
const BUDGET_A_FLUSH_SLOW_MS = 50; //   focused event alone, slow link
// Scenario B/C/D/E are CHARACTERIZATION assertions of current leaky behavior.
// REGRESSION TARGET: once openspec_update is subscription-scoped, a focused
// socket viewing cwd A must receive ZERO bytes for cwds B/C, i.e.
// wastedBytes(focusedSocket) === 0 and scenario-B focused latency collapses to
// the scenario-A budget.
const SCENARIO_B_IDLE_CWDS = 8;
const SCENARIO_B_PAYLOAD_BYTES = 50_000; // moderate per-cwd openspec payload

const FOCUSED_CWD = "/repo/focused";
const idleCwds = (n: number) => Array.from({ length: n }, (_, i) => `/repo/idle-${i}`);

/** Fire one `openspec_update` per idle cwd (the per-poll-tick fan-out). */
function fireOpenSpecBurst(
  gateway: ReturnType<typeof buildLoadGateway>,
  cwds: string[],
  payloadBytes: number,
): void {
  const serialized = JSON.stringify(makeOpenSpecPayload(payloadBytes));
  for (const cwd of cwds) gateway.broadcastOpenSpecUpdate(cwd, serialized);
}

/**
 * Classify a latency-over-virtual-time series as `periodic` (poll-cadence
 * driven — openspec) or `flat` (continuous — upstream). Encodes the decision
 * rule for the original lag report. A `periodic` verdict requires >= 2 evenly
 * spaced rising edges above the mid-range threshold.
 */
function classifyLatencySignature(series: number[]): {
  kind: "periodic" | "flat";
  risingEdges: number[];
  gaps: number[];
} {
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min;
  // Flat: negligible variation relative to magnitude.
  if (max === 0 || range / Math.max(max, 1e-9) < 0.1) {
    return { kind: "flat", risingEdges: [], gaps: [] };
  }
  const threshold = min + range / 2;
  const risingEdges: number[] = [];
  if (series[0] > threshold) risingEdges.push(0);
  for (let i = 1; i < series.length; i++) {
    if (series[i] > threshold && series[i - 1] <= threshold) risingEdges.push(i);
  }
  if (risingEdges.length < 2) return { kind: "flat", risingEdges, gaps: [] };
  const gaps: number[] = [];
  for (let i = 1; i < risingEdges.length; i++) gaps.push(risingEdges[i] - risingEdges[i - 1]);
  const periodic = Math.max(...gaps) - Math.min(...gaps) <= 1; // 1-sample tolerance
  return { kind: periodic ? "periodic" : "flat", risingEdges, gaps };
}

const isFocusedEvent = (focusedSessionId: string) => (r: { type?: string; sessionId?: string }) =>
  r.type === "event" && r.sessionId === focusedSessionId;
const isWastedOpenSpec = (focusedCwd: string) => (r: { type?: string; cwd?: string }) =>
  r.type === "openspec_update" && r.cwd !== undefined && r.cwd !== focusedCwd;

describe("browser-gateway load — scenario A (baseline: focused, no openspec)", () => {
  for (const [label, rate, budget] of [
    ["FAST", DRAIN_FAST, BUDGET_A_FLUSH_FAST_MS],
    ["SLOW", DRAIN_SLOW, BUDGET_A_FLUSH_SLOW_MS],
  ] as const) {
    it(`focused event flushes within budget at ${label}`, () => {
      const seed = seedSessions({ focusedCwd: FOCUSED_CWD, idleCwds: [] });
      const gateway = buildLoadGateway(seed.manager);
      const ws = createDrainingWs({ drainRateBytesPerMs: rate });
      subscribeWs(gateway, ws, seed.focusedSessionId);

      gateway.broadcastEvent(seed.focusedSessionId, 1, { type: "message_update", text: "hi" });

      const flush = ws.timeToFlush(isFocusedEvent(seed.focusedSessionId));
      expect(flush).toBeDefined();
      expect(flush!).toBeLessThan(budget);
    });
  }
});

describe("browser-gateway load — scenario B (focused + N idle cwds firing openspec)", () => {
  for (const [label, rate] of [
    ["FAST", DRAIN_FAST],
    ["SLOW", DRAIN_SLOW],
  ] as const) {
    it(`focused event waits behind cross-cwd openspec traffic at ${label}`, () => {
      // Baseline: isolated gateway/socket, focused event alone.
      const aloneSeed = seedSessions({ focusedCwd: FOCUSED_CWD, idleCwds: [] });
      const aloneGw = buildLoadGateway(aloneSeed.manager);
      const alone = createDrainingWs({ drainRateBytesPerMs: rate });
      subscribeWs(aloneGw, alone, aloneSeed.focusedSessionId);
      aloneGw.broadcastEvent(aloneSeed.focusedSessionId, 1, { type: "message_update", text: "hi" });
      const aloneFlush = alone.timeToFlush(isFocusedEvent(aloneSeed.focusedSessionId))!;

      // Measured: idle-cwd openspec burst lands first, THEN the focused event.
      const seed = seedSessions({ focusedCwd: FOCUSED_CWD, idleCwds: idleCwds(SCENARIO_B_IDLE_CWDS) });
      const gateway = buildLoadGateway(seed.manager);
      const ws = createDrainingWs({ drainRateBytesPerMs: rate });
      subscribeWs(gateway, ws, seed.focusedSessionId);
      fireOpenSpecBurst(gateway, seed.idle.map((i) => i.cwd), SCENARIO_B_PAYLOAD_BYTES);
      gateway.broadcastEvent(seed.focusedSessionId, 1, { type: "message_update", text: "behind" });

      const behindFlush = ws.timeToFlush(isFocusedEvent(seed.focusedSessionId))!;

      // Head-of-line: focused event flushes later when openspec competes.
      expect(behindFlush).toBeGreaterThan(aloneFlush);

      // Cross-cwd leak: focused socket receives bytes for cwds it does not view.
      const wasted = ws.bytesWhere(isWastedOpenSpec(FOCUSED_CWD));
      expect(wasted).toBeGreaterThan(0); // REGRESSION TARGET: === 0 after scoped fan-out
    });
  }
});

describe("browser-gateway load — scenario C (payload-size amplifier)", () => {
  it("focused latency and peak buffer grow with per-cwd payload size", () => {
    const rate = DRAIN_SLOW;
    const run = (payloadBytes: number) => {
      const seed = seedSessions({ focusedCwd: FOCUSED_CWD, idleCwds: idleCwds(SCENARIO_B_IDLE_CWDS) });
      const gateway = buildLoadGateway(seed.manager);
      const ws = createDrainingWs({ drainRateBytesPerMs: rate });
      subscribeWs(gateway, ws, seed.focusedSessionId);
      fireOpenSpecBurst(gateway, seed.idle.map((i) => i.cwd), payloadBytes);
      gateway.broadcastEvent(seed.focusedSessionId, 1, { type: "message_update", text: "x" });
      return {
        flush: ws.timeToFlush(isFocusedEvent(seed.focusedSessionId))!,
        peak: ws.peakBufferedAmount(),
      };
    };

    const small = run(10_000);
    const large = run(200_000);
    expect(large.flush).toBeGreaterThan(small.flush);
    expect(large.peak).toBeGreaterThan(small.peak);
  });
});

describe("browser-gateway load — scenario D (cold-boot connect burst)", () => {
  it("over-budget connect storm drops frames via the MAX_WS_BUFFER guard", () => {
    const rate = DRAIN_SLOW; // slow socket: does not drain during the burst
    const knownDirs = idleCwds(12);
    const seed = seedSessions({ focusedCwd: FOCUSED_CWD, idleCwds: knownDirs });
    const gateway = buildLoadGateway(seed.manager);
    // One client connecting during the storm.
    const [ws] = attachClients(gateway, 1, { drainRateBytesPerMs: rate });

    // ~1 MB per dir, no drain between sends → buffer crosses 4 MB MAX_WS_BUFFER.
    const serialized = JSON.stringify(makeOpenSpecPayload(1_000_000));
    let attempted = 0;
    for (const cwd of knownDirs) {
      gateway.broadcastOpenSpecUpdate(cwd, serialized);
      attempted++;
    }

    const delivered = ws.bytesWhere((r) => r.type === "openspec_update");
    const deliveredCount = ws.sent.filter((r) => r.type === "openspec_update").length;
    const dropped = attempted - deliveredCount;

    expect(ws.peakBufferedAmount()).toBeGreaterThan(4 * 1024 * 1024);
    expect(dropped).toBeGreaterThan(0); // silently-dropped frames the client never sees
    expect(delivered).toBeGreaterThan(0);
  });
});

describe("browser-gateway load — scenario E (poll cadence signature)", () => {
  // Simulate 6× tick density (60 s → 10 s) over a fixed 60 s virtual window.
  const WINDOW_MS = 60_000;
  const TICK_MS = 10_000;
  const STEP_MS = 1_000;

  function sampleLatencySeries(opts: { withOpenSpec: boolean }): number[] {
    const rate = DRAIN_SLOW;
    const seed = seedSessions({ focusedCwd: FOCUSED_CWD, idleCwds: idleCwds(4) });
    const gateway = buildLoadGateway(seed.manager);
    const ws = createDrainingWs({ drainRateBytesPerMs: rate });
    subscribeWs(gateway, ws, seed.focusedSessionId);
    const serialized = JSON.stringify(makeOpenSpecPayload(250_000)); // 4 × 250 KB ≈ 1 MB burst
    const series: number[] = [];
    for (let t = 0; t <= WINDOW_MS; t += STEP_MS) {
      if (opts.withOpenSpec && t % TICK_MS === 0) {
        for (const { cwd } of seed.idle) gateway.broadcastOpenSpecUpdate(cwd, serialized);
      }
      // Latency proxy: time for a frame enqueued NOW to flush = buffer / rate.
      series.push(ws.bufferedAmount / ws.drainRateBytesPerMs);
      ws.advance(STEP_MS);
    }
    return series;
  }

  it("periodic openspec bursts produce a PERIODIC latency signature", () => {
    const series = sampleLatencySeries({ withOpenSpec: true });
    const sig = classifyLatencySignature(series);
    expect(sig.kind).toBe("periodic");
    // Spike spacing aligns with the tick interval (10 samples @ 1 s step).
    expect(sig.gaps.every((g) => g === TICK_MS / STEP_MS)).toBe(true);
  });

  it("no competing openspec traffic produces a FLAT signature", () => {
    const series = sampleLatencySeries({ withOpenSpec: false });
    expect(classifyLatencySignature(series).kind).toBe("flat");
  });
});
