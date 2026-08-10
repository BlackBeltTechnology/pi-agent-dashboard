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
import { describe, it, expect, vi } from "vitest";
import {
  DRAIN_FAST,
  DRAIN_SLOW,
  seedSessions,
  buildLoadGateway,
  buildLoadGatewayEx,
  makeFakeDirectoryService,
  makeUntruncatedEventStore,
  seedReplayEvents,
  sendMessage,
  flushAsync,
  makeOpenSpecPayload,
  attachClients,
  subscribeWs,
} from "./helpers/load-fixtures.js";
import { createDrainingWs } from "./helpers/draining-ws.js";

// The bulk-archive site under test is the `pollDirectoryGated(...).then().catch()`
// chain, NOT the synchronous `archiveCompleted` spawn that precedes it. Mock the
// shared spawn away so the oracle isolates the async site deterministically
// (no real `openspec archive` subprocess). Scenarios A–E never call it.
// See change: cleanup-async-semantics-server-extension (test-plan #P1).
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js")>();
  return { ...actual, archiveCompleted: vi.fn(() => ({ ok: true, value: "" })) };
});

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

// ─────────────────────────────────────────────────────────────────────────
// P1 / P2 / P3 — close the D2 coverage gap.
//
// design.md D2 states the base A–E harness sends exactly one inbound message
// (`{ type: "subscribe" }`) and never calls `start()`, so a wrongly-added
// `await` at directory-handler / browser-gateway-shutdown / subscription-replay
// sites CANNOT fail it. These scenarios DRIVE those message paths through the
// REAL gateway and prove the sites land via spies/counters — not coverage.
// See change: cleanup-async-semantics-server-extension (test-plan #P1/#P2/#P3).
// ─────────────────────────────────────────────────────────────────────────

describe("browser-gateway load — P1 (oracle reaches the previously-unreached async sites)", () => {
  const OPENSPEC_CWD = "/repo/openspec-target";
  // Generous virtual-ms landing ceiling. These frames are tiny; a DEFINED,
  // finite flush within this bound proves the resulting frame landed on the
  // socket INSIDE the measured window — it is not an absolute-latency target.
  const BUDGET_P1_FLUSH_MS = 50; // ABSOLUTE (virtual ms), landing check only

  it("openspec_refresh (resolve) reaches directory-handler and broadcasts openspec_update", async () => {
    // Site: directory-handler.ts handleOpenSpecRefresh → refreshOpenSpec().then(broadcast)
    const seed = seedSessions({ focusedCwd: OPENSPEC_CWD, idleCwds: [] });
    const fake = makeFakeDirectoryService({});
    const { gateway } = buildLoadGatewayEx(seed.manager, { directoryService: fake.service });
    const [ws] = attachClients(gateway, 1, { drainRateBytesPerMs: DRAIN_FAST });

    sendMessage(ws, { type: "openspec_refresh", cwd: OPENSPEC_CWD });
    await flushAsync();

    // Counter: the handler reached the refresh site exactly once.
    expect(fake.refreshOpenSpec).toHaveBeenCalledTimes(1);
    expect(fake.refreshOpenSpec).toHaveBeenCalledWith(OPENSPEC_CWD);
    // The `.then` continuation ran INSIDE the window: an openspec_update landed.
    const flush = ws.timeToFlush((r) => r.type === "openspec_update" && r.cwd === OPENSPEC_CWD);
    expect(flush).toBeDefined();
    expect(flush!).toBeLessThan(BUDGET_P1_FLUSH_MS);
  });

  it("openspec_refresh (reject) routes through the added .catch (rejection is observed, not floated)", async () => {
    // Site: directory-handler.ts handleOpenSpecRefresh → .catch(console.warn)
    const seed = seedSessions({ focusedCwd: OPENSPEC_CWD, idleCwds: [] });
    const fake = makeFakeDirectoryService({ refresh: { reject: new Error("refresh boom") } });
    const { gateway } = buildLoadGatewayEx(seed.manager, { directoryService: fake.service });
    const [ws] = attachClients(gateway, 1, { drainRateBytesPerMs: DRAIN_FAST });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    sendMessage(ws, { type: "openspec_refresh", cwd: OPENSPEC_CWD });
    await flushAsync();

    expect(fake.refreshOpenSpec).toHaveBeenCalledTimes(1);
    // Counter: the added rejection handler fired.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`[openspec] refresh failed for ${OPENSPEC_CWD}`),
      expect.anything(),
    );
    // No openspec_update broadcast on the reject path.
    expect(ws.sent.some((r) => r.type === "openspec_update" && r.cwd === OPENSPEC_CWD)).toBe(false);
    warn.mockRestore();
  });

  it("openspec_bulk_archive (resolve) reaches directory-handler's post-archive poll and broadcasts", async () => {
    // Site: directory-handler.ts handleOpenSpecBulkArchive → pollDirectoryGated().then(broadcast)
    const seed = seedSessions({ focusedCwd: OPENSPEC_CWD, idleCwds: [] });
    const fake = makeFakeDirectoryService({});
    const { gateway } = buildLoadGatewayEx(seed.manager, { directoryService: fake.service });
    const [ws] = attachClients(gateway, 1, { drainRateBytesPerMs: DRAIN_FAST });

    sendMessage(ws, { type: "openspec_bulk_archive", cwd: OPENSPEC_CWD });
    await flushAsync();

    expect(fake.pollDirectoryGated).toHaveBeenCalledTimes(1);
    expect(fake.pollDirectoryGated).toHaveBeenCalledWith(OPENSPEC_CWD);
    const flush = ws.timeToFlush((r) => r.type === "openspec_update" && r.cwd === OPENSPEC_CWD);
    expect(flush).toBeDefined();
    expect(flush!).toBeLessThan(BUDGET_P1_FLUSH_MS);
  });

  it("openspec_bulk_archive (reject) routes the post-archive poll through the added .catch", async () => {
    // Site: directory-handler.ts handleOpenSpecBulkArchive → .catch(console.warn)
    const seed = seedSessions({ focusedCwd: OPENSPEC_CWD, idleCwds: [] });
    const fake = makeFakeDirectoryService({ poll: { reject: new Error("poll boom") } });
    const { gateway } = buildLoadGatewayEx(seed.manager, { directoryService: fake.service });
    const [ws] = attachClients(gateway, 1, { drainRateBytesPerMs: DRAIN_FAST });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    sendMessage(ws, { type: "openspec_bulk_archive", cwd: OPENSPEC_CWD });
    await flushAsync();

    expect(fake.pollDirectoryGated).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`[openspec] post-archive poll failed for ${OPENSPEC_CWD}`),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("shutdown drives handleShutdown past its awaited kill and broadcasts session_removed", async () => {
    // Site: browser-gateway.ts `await handleShutdown(msg, ctx)` (design D1)
    const seed = seedSessions({ focusedCwd: OPENSPEC_CWD, idleCwds: [] });
    const { gateway, piGateway } = buildLoadGatewayEx(seed.manager);
    const [ws] = attachClients(gateway, 1, { drainRateBytesPerMs: DRAIN_FAST });

    sendMessage(ws, { type: "shutdown", sessionId: seed.focusedSessionId });
    await flushAsync();

    // Counter: the pre-await forward fired.
    expect(piGateway.sendToSession).toHaveBeenCalledWith(seed.focusedSessionId, {
      type: "shutdown",
      sessionId: seed.focusedSessionId,
    });
    // The POST-await tail ran (unregister + broadcast) INSIDE the window — this
    // is the frame a wrongly-serialized `await handleShutdown` would delay/lose.
    const flush = ws.timeToFlush((r) => r.type === "session_removed" && r.sessionId === seed.focusedSessionId);
    expect(flush).toBeDefined();
    expect(flush!).toBeLessThan(BUDGET_P1_FLUSH_MS);
    // `unregister` marks the session ended (memory manager retains the record).
    expect(seed.manager.get(seed.focusedSessionId)?.status).toBe("ended");
  });
});

describe("browser-gateway load — P2 (existing A/B budgets do not regress with the extension wired)", () => {
  const FOCUSED = "/repo/focused-p2";

  // ABSOLUTE budgets: reuse scenario-A's focused-flush ceilings unchanged.
  for (const [label, rate, budget] of [
    ["FAST", DRAIN_FAST, BUDGET_A_FLUSH_FAST_MS],
    ["SLOW", DRAIN_SLOW, BUDGET_A_FLUSH_SLOW_MS],
  ] as const) {
    it(`focused event still flushes within scenario-A budget after driving openspec_refresh + bulk_archive at ${label}`, async () => {
      const seed = seedSessions({ focusedCwd: FOCUSED, idleCwds: [] });
      const fake = makeFakeDirectoryService({ knownDirectories: [FOCUSED] });
      const { gateway } = buildLoadGatewayEx(seed.manager, { directoryService: fake.service });
      const ws = createDrainingWs({ drainRateBytesPerMs: rate });
      subscribeWs(gateway, ws, seed.focusedSessionId);

      // Drive the extension's new message paths, then treat that (bootstrap +
      // openspec) traffic as pre-window setup by draining before we measure —
      // exactly how scenario A treats the on-connect snapshot.
      sendMessage(ws, { type: "openspec_refresh", cwd: FOCUSED });
      sendMessage(ws, { type: "openspec_bulk_archive", cwd: FOCUSED });
      await flushAsync();
      ws.drainFully();

      gateway.broadcastEvent(seed.focusedSessionId, 1, { type: "message_update", text: "hi" });
      const flush = ws.timeToFlush(isFocusedEvent(seed.focusedSessionId));
      expect(flush).toBeDefined();
      expect(flush!).toBeLessThan(budget);
    });
  }

  it("scenario-B head-of-line inequality still holds on the extended gateway (RELATIVE)", () => {
    const rate = DRAIN_SLOW;
    // Baseline: focused event alone on an extended gateway.
    const a = seedSessions({ focusedCwd: FOCUSED, idleCwds: [] });
    const { gateway: aGw } = buildLoadGatewayEx(a.manager, {
      directoryService: makeFakeDirectoryService({}).service,
    });
    const alone = createDrainingWs({ drainRateBytesPerMs: rate });
    subscribeWs(aGw, alone, a.focusedSessionId);
    aGw.broadcastEvent(a.focusedSessionId, 1, { type: "message_update", text: "hi" });
    const aloneFlush = alone.timeToFlush(isFocusedEvent(a.focusedSessionId))!;

    // Measured: focused event behind a cross-cwd openspec burst.
    const seed = seedSessions({ focusedCwd: FOCUSED, idleCwds: idleCwds(SCENARIO_B_IDLE_CWDS) });
    const { gateway } = buildLoadGatewayEx(seed.manager, {
      directoryService: makeFakeDirectoryService({}).service,
    });
    const ws = createDrainingWs({ drainRateBytesPerMs: rate });
    subscribeWs(gateway, ws, seed.focusedSessionId);
    fireOpenSpecBurst(gateway, seed.idle.map((i) => i.cwd), SCENARIO_B_PAYLOAD_BYTES);
    gateway.broadcastEvent(seed.focusedSessionId, 1, { type: "message_update", text: "behind" });
    const behindFlush = ws.timeToFlush(isFocusedEvent(seed.focusedSessionId))!;

    expect(behindFlush).toBeGreaterThan(aloneFlush);
  });
});

describe("browser-gateway load — P3 (replay path INSIDE the measured window)", () => {
  const SID_CWD = "/repo/replay";
  const REPLAY_PAD_BYTES = 1_000;
  // REPLAY_BATCH_SIZE is 200 (subscription-handler.ts). Keep total replay bytes
  // < BACKPRESSURE_THRESHOLD (1 MB) so sendEventBatches stays on the setImmediate
  // yield path and never enters the real-timer backpressure poll.

  /** Cold-subscribe with a NON-EMPTY backlog and let the replay settle. */
  async function runReplay(count: number, rate: number): Promise<ReturnType<typeof createDrainingWs>> {
    const store = makeUntruncatedEventStore();
    const seed = seedSessions({ focusedCwd: SID_CWD, idleCwds: [] });
    seedReplayEvents(store, seed.focusedSessionId, count, REPLAY_PAD_BYTES);
    const { gateway } = buildLoadGatewayEx(seed.manager, { eventStore: store });
    const ws = createDrainingWs({ drainRateBytesPerMs: rate });
    gateway.wss.emit("connection", ws, {});
    ws.drainFully(); // measurement window opens here (no bootstrap frames without prefs/dirs)
    sendMessage(ws, { type: "subscribe", sessionId: seed.focusedSessionId });
    await flushAsync();
    return ws;
  }

  it("reaches the replay sites and drains within its own byte-budget (ABSOLUTE floor)", async () => {
    const rate = DRAIN_SLOW;
    const count = 250; // > one 200-event batch
    const ws = await runReplay(count, rate);

    // Counter: replay sites executed inside the window and the FULL backlog
    // reached the wire (every event carries ≥ REPLAY_PAD_BYTES of payload).
    const replayFrames = ws.sent.filter((r) => r.type === "event_replay");
    expect(replayFrames.length).toBeGreaterThanOrEqual(1);
    const replayBytes = ws.bytesWhere((r) => r.type === "event_replay");
    expect(replayBytes).toBeGreaterThan(count * REPLAY_PAD_BYTES);

    // No serialization tax: the backlog drains in exactly its byte-time, not
    // longer. floor = total replay bytes / drain rate (buffer never drained
    // mid-replay, so the last frame's flush IS the whole-backlog drain time).
    const flushes = ws.flushTimes((r) => r.type === "event_replay");
    const drainLatency = flushes[flushes.length - 1];
    const floor = replayBytes / rate;
    expect(drainLatency).toBeGreaterThan(0);
    expect(drainLatency).toBeLessThanOrEqual(floor * 1.01);
    expect(drainLatency).toBeGreaterThanOrEqual(floor * 0.99);
  });

  it("replay drain latency scales linearly with backlog size (RELATIVE — no super-linear serialization)", async () => {
    const rate = DRAIN_SLOW;
    const wsBase = await runReplay(250, rate);
    const wsDouble = await runReplay(500, rate);

    const latOf = (ws: ReturnType<typeof createDrainingWs>) => {
      const f = ws.flushTimes((r) => r.type === "event_replay");
      return f[f.length - 1];
    };
    const ratio = latOf(wsDouble) / latOf(wsBase);
    // Doubling the backlog roughly doubles drain time; a super-linear blowup
    // (accidental serialization) would push this well past 2×.
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  it("a replay whose send throws routes through onReplayFailed (.catch) and clears the replay flag", async () => {
    // Site: subscription-handler.ts sendEventBatches(...).then(...).catch(onReplayFailed)
    const rate = DRAIN_FAST;
    const store = makeUntruncatedEventStore();
    const seed = seedSessions({ focusedCwd: SID_CWD, idleCwds: [] });
    seedReplayEvents(store, seed.focusedSessionId, 10, 100);
    const { gateway } = buildLoadGatewayEx(seed.manager, { eventStore: store });
    const ws = createDrainingWs({ drainRateBytesPerMs: rate });
    gateway.wss.emit("connection", ws, {});
    ws.drainFully();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Make ONLY event_replay sends throw, so sendEventBatches rejects at the site.
    const origSend = ws.send.bind(ws);
    ws.send = (frame: string | Buffer) => {
      const s = typeof frame === "string" ? frame : frame.toString("utf8");
      if (s.includes('"type":"event_replay"')) throw new Error("send failed");
      origSend(frame);
    };

    sendMessage(ws, { type: "subscribe", sessionId: seed.focusedSessionId });
    await flushAsync();

    // The added `.catch(onReplayFailed)` ran (logged, and cleared the flag).
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[replay] event replay failed for ${seed.focusedSessionId}`),
      expect.anything(),
    );
    // Flag cleared → a subsequent live event is delivered, not suppressed.
    gateway.broadcastEvent(seed.focusedSessionId, 99, { type: "message_update", text: "live" });
    const live = ws.sent.filter((r) => r.type === "event" && r.sessionId === seed.focusedSessionId);
    expect(live.length).toBe(1);
    errSpy.mockRestore();
  });
});
