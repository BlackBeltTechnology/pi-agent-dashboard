/**
 * Tasks 1.2 + 3.4 for change: fix-stuck-tool-card-on-dropped-event.
 *
 * The server→browser fanout silently drops a frame when a browser socket's
 * `bufferedAmount` crosses MAX_WS_BUFFER. This suite:
 *  - documents the drop (1.2 — the frame never reaches the socket)
 *  - proves the drop is now COUNTED per-session + rate-limited-LOGGED (3.4)
 *  - proves the counters are surfaced via `getDroppedFrameStats()` (3.3/3.4)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { createBrowserGateway, frameClassOf } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createDrainingWs } from "./helpers/draining-ws.js";
import { buildLoadGateway, makeStubPiGateway, seedSessions, subscribeWs } from "./helpers/load-fixtures.js";
import { asWs, attachCapturedWs, buildDebtGateway, TEST_MAX_WS_BUFFER } from "./helpers/status-debt-fixtures.js";

const MAX_WS_BUFFER = 4 * 1024 * 1024; // gateway default


/** Fill a subscribed socket's send buffer past MAX_WS_BUFFER via broadcastEvent. */
function overloadSocket(gateway: ReturnType<typeof buildLoadGateway>, sessionId: string) {
  // Slow drain so the buffer never clears between sends.
  const ws = createDrainingWs({ drainRateBytesPerMs: 1 });
  subscribeWs(gateway, ws, sessionId);
  // ~5 MB single frame pushes bufferedAmount over the 4 MB cap immediately.
  gateway.broadcastEvent(sessionId, 1, { type: "message_update", text: "x".repeat(5 * 1024 * 1024) });
  return ws;
}

describe("server→browser dropped-frame instrumentation", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("silently drops the frame off the wire (1.2 baseline) but now counts it", () => {
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    const ws = overloadSocket(gateway, seed.focusedSessionId);

    expect(ws.peakBufferedAmount()).toBeGreaterThan(MAX_WS_BUFFER);

    // The NEXT event for this session is dropped (buffer still over cap).
    gateway.broadcastEvent(seed.focusedSessionId, 2, { type: "tool_execution_end", data: { toolCallId: "t1" } });

    // Drop is observable: it never landed as a seq-2 frame on the wire…
    const seq2Landed = ws.sent.some((r) => r.type === "event" && r.bytes < 1000);
    expect(seq2Landed).toBe(false);

    // …and the counter recorded it, attributed to the session.
    const stats = gateway.getDroppedFrameStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.bySession[seed.focusedSessionId]).toBeGreaterThanOrEqual(1);
  });

  it("emits a rate-limited warning carrying hop/sessionId/seq/bufferedAmount", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    overloadSocket(gateway, seed.focusedSessionId);

    gateway.broadcastEvent(seed.focusedSessionId, 2, { type: "tool_execution_end", data: { toolCallId: "t1" } });

    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes("dropped frame"));
    expect(msg).toBeDefined();
    expect(msg).toContain("hop=server→browser");
    expect(msg).toContain(`sessionId=${seed.focusedSessionId}`);
    expect(msg).toContain("seq=2");
    expect(msg).toContain("bufferedAmount=");
  });

  it("rate-limits the warning: a storm of drops logs at most once per window", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    overloadSocket(gateway, seed.focusedSessionId);

    for (let seq = 2; seq < 20; seq++) {
      gateway.broadcastEvent(seed.focusedSessionId, seq, { type: "tool_execution_end", data: { toolCallId: `t${seq}` } });
    }

    const dropWarns = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("dropped frame"));
    // Many drops, but at most one warning inside the 5 s window.
    expect(dropWarns.length).toBe(1);
    // All drops still counted.
    expect(gateway.getDroppedFrameStats().total).toBeGreaterThanOrEqual(18);
  });

  it("reports zero drops for a healthy (draining) socket", () => {
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    const ws = createDrainingWs({ drainRateBytesPerMs: 50_000 });
    subscribeWs(gateway, ws, seed.focusedSessionId);
    gateway.broadcastEvent(seed.focusedSessionId, 1, { type: "message_update", text: "hi" });
    expect(gateway.getDroppedFrameStats().total).toBe(0);
  });
});

// ── Frame delivery classes (D1) — see change: fix-connect-snapshot-frame-loss ──

describe("frameClassOf — static class per message type (E1)", () => {
  const asMsg = (m: unknown) => m as ServerToBrowserMessage;

  it("state types without an entity key use the bare type as key", () => {
    for (const type of [
      "sessions_snapshot",
      "pinned_dirs_updated",
      "workspaces_updated",
      "favorite_models_updated",
      "display_prefs_updated",
      "reachability_updated",
    ]) {
      expect(frameClassOf(asMsg({ type }))).toEqual({ cls: "state", key: type });
    }
  });

  it("cwd-keyed state types carry the type in the key (openspec vs git differ)", () => {
    expect(frameClassOf(asMsg({ type: "openspec_update", cwd: "/a" }))).toEqual({ cls: "state", key: "openspec_update:/a" });
    expect(frameClassOf(asMsg({ type: "git_head_update", cwd: "/a", branch: "develop" }))).toEqual({ cls: "state", key: "git_head_update:/a" });
    expect(frameClassOf(asMsg({ type: "sessions_page_result", cwd: "/a" }))).toEqual({ cls: "state", key: "sessions_page_result:/a" });
    // Same cwd, DIFFERENT keys — the type is always part of the key.
    expect(frameClassOf(asMsg({ type: "openspec_update", cwd: "/a" })).key).not.toBe(
      frameClassOf(asMsg({ type: "git_head_update", cwd: "/a", branch: "develop" })).key,
    );
  });

  it("openspec_get_result keys on requestId + phase (two-phase reply preserved)", () => {
    const placeholder = frameClassOf(asMsg({ type: "openspec_get_result", cwd: "/a", requestId: "r1", final: false }));
    const final = frameClassOf(asMsg({ type: "openspec_get_result", cwd: "/a", requestId: "r1", final: true }));
    const other = frameClassOf(asMsg({ type: "openspec_get_result", cwd: "/a", requestId: "r2", final: false }));
    expect(placeholder).toEqual({ cls: "state", key: "openspec_get_result:/a:r1:placeholder" });
    expect(final.key).toBe("openspec_get_result:/a:r1:final");
    // The final must NOT coalesce over its own queued placeholder…
    expect(final.key).not.toBe(placeholder.key);
    // …and a newer request must not coalesce over an older one.
    expect(other.key).not.toBe(placeholder.key);
  });

  it("terminal lifecycle frames for one id share a single key", () => {
    const added = frameClassOf(asMsg({ type: "terminal_added", terminal: { id: "t1" } }));
    const updated = frameClassOf(asMsg({ type: "terminal_updated", terminalId: "t1" }));
    const removed = frameClassOf(asMsg({ type: "terminal_removed", terminalId: "t1" }));
    expect(added).toEqual({ cls: "state", key: "terminal:t1" });
    expect(updated.key).toBe("terminal:t1");
    expect(removed.key).toBe("terminal:t1");
  });

  it("session registry frames and per-session events are transcript-class", () => {
    expect(frameClassOf(asMsg({ type: "session_updated", sessionId: "s", updates: {} }))).toEqual({ cls: "transcript", key: "session_updated" });
    expect(frameClassOf(asMsg({ type: "sessions_reordered", cwd: "/a", sessionIds: [] }))).toEqual({ cls: "transcript", key: "sessions_reordered" });
    expect(frameClassOf(asMsg({ type: "event", sessionId: "s", seq: 1, event: {} }))).toEqual({ cls: "transcript", key: "event" });
  });
});

// ── State frames are deferred, never shed (D2) — E2 BVA on bufferedAmount ──

describe("state frame survives a saturated socket (E2)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sendTo(openspec_update) sends at 999/1000 and defers at 1001 (no transcript drop)", () => {
    for (const bufferedAmount of [999, 1000]) {
      const gateway = createBrowserGateway(
        createMemorySessionManager(),
        createMemoryEventStore(() => false),
        makeStubPiGateway(),
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        1000, // maxWsBufferBytes
      );
      const ws = createDrainingWs({ drainRateBytesPerMs: 0 });
      ws.bufferedAmount = bufferedAmount;
      gateway.wss.emit("connection", ws, {});
      ws.drainFully();
      ws.bufferedAmount = bufferedAmount;
      const sentBefore = ws.sent.length;

      gateway.sendToClient(asWs(ws), {
        type: "openspec_update",
        cwd: "/a",
        data: { initialized: true, changes: [] },
      });

      expect(ws.sent.length, `bufferedAmount=${bufferedAmount} → sent immediately`).toBe(sentBefore + 1);
      expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
    }

    // 1001 > threshold → deferred, NOT dropped.
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      1000,
    );
    const ws = createDrainingWs({ drainRateBytesPerMs: 0 });
    gateway.wss.emit("connection", ws, {});
    ws.drainFully();
    ws.bufferedAmount = 1001;
    const sentBefore = ws.sent.length;

    gateway.sendToClient(asWs(ws), {
      type: "openspec_update",
      cwd: "/a",
      data: { initialized: true, changes: [] },
    });

    expect(ws.sent.length).toBe(sentBefore); // nothing on the wire yet
    expect(gateway.getPendingStateInfo(asWs(ws))?.entries).toBe(1); // deferred in the pending map
    const stats = gateway.getDroppedFrameStats();
    expect(stats.total).toBe(0); // never counted as a transcript drop
    expect(stats.coalescedState).toBe(0);
  });
});

// ── Status-reconcile debt register ──────────────────────────────────────
// A shed `session_updated` is unbounded-stale: no seq, no backfill, no
// guaranteed successor frame. It is therefore recorded as a DEBT owed to the
// socket and re-sent from CURRENT server state once the socket drains.
// See change: fix-backpressure-status-and-subagent-frames.

describe("status-reconcile debt capture (E2/E3/E4/E8)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records ONLY session_updated — the registry siblings stay unrecovered (E2)", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();

    // Every one of these is transcript-class and is shed at this bufferedAmount.
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    gateway.broadcastToAll({ type: "sessions_reordered", cwd: "/repo/a", sessionIds: ["s1"] } as ServerToBrowserMessage);
    gateway.broadcastSessionAdded({ id: "s2", cwd: "/repo/a" });
    gateway.broadcastSessionRemoved("s2");
    gateway.broadcastToAll({ type: "file_changed", cwd: "/repo/a", path: "a.ts" } as unknown as ServerToBrowserMessage);

    // Exactly the one status id is owed — the other four leave no debt behind.
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))?.owed).toEqual(["s1"]);
    expect(gateway.getDroppedFrameStats().statusReconcileQueued).toBe(1);
    // …while all five were still counted as drops.
    expect(gateway.getDroppedFrameStats().total).toBe(5);
  });

  it("holds ids only, deduped, and never nears the byte ceiling (E3)", () => {
    const ids = Array.from({ length: 100 }, (_, i) => `s${i}`);
    const { gateway } = buildDebtGateway(ids);
    const client = attachCapturedWs(gateway);
    client.saturate();

    for (let round = 0; round < 10; round++) {
      for (const id of ids) gateway.broadcastSessionUpdated(id, { status: "streaming" });
    }

    const info = gateway.getStatusReconcileInfo(asWs(client.ws));
    // 1 000 sheds collapse to 100 owed ids — a Set of ids, not a queue of frames.
    expect(info?.owed.length).toBe(100);
    expect(new Set(info?.owed).size).toBe(100);
    // The debt is NOT retained as pending-state bytes, so it cannot terminate
    // the socket the way a per-session state key family could.
    expect(gateway.getPendingStateInfo(asWs(client.ws))).toBeUndefined();
    expect(gateway.getDroppedFrameStats().stalledSocketsTerminated).toBe(0);
    // Every shed is still counted, even the deduped ones.
    expect(gateway.getDroppedFrameStats().statusReconcileQueued).toBe(1000);
  });

  it("at exactly the threshold the frame is sent, not shed — the predicate is > (E4)", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.ws.bufferedAmount = TEST_MAX_WS_BUFFER; // exactly at, not over

    gateway.broadcastSessionUpdated("s1", { status: "streaming" });

    expect(client.statusFrames()).toHaveLength(1);
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
    expect(gateway.getDroppedFrameStats().statusReconcileQueued).toBe(0);
  });

  it("a shed status frame counts as BOTH a drop and a debt (E8)", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();

    gateway.broadcastSessionUpdated("s1", { status: "streaming" });

    const stats = gateway.getDroppedFrameStats();
    // The reconcile must NOT mask the shed it recovers from.
    expect(stats.total).toBe(1);
    expect(stats.statusReconcileQueued).toBe(1);
  });
});

describe("status-reconcile flush (E1/E5/E7, X4/X5)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("redelivers CURRENT state after drain, not the shed payload (E1)", () => {
    const { gateway, manager } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();

    // The shed frame carried only `status`; the server's state moved on.
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    manager.update("s1", { status: "streaming", currentTool: "Agent" });
    expect(client.statusFrames()).toHaveLength(0);

    client.drain();
    vi.advanceTimersByTime(1000); // the spec's bound

    const delivered = client.statusFrames();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].sessionId).toBe("s1");
    // Rebuilt from the session manager — `currentTool` was never in the shed frame.
    expect(delivered[0].updates.status).toBe("streaming");
    expect(delivered[0].updates.currentTool).toBe("Agent");
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(1);
    // Debt settled → set and timer released.
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
  });

  it("delivers the settled value once; no intermediate edge is synthesized (E5)", () => {
    const { gateway, manager } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();

    for (const status of ["idle", "streaming", "idle"] as const) {
      manager.update("s1", { status });
      gateway.broadcastSessionUpdated("s1", { status });
    }

    client.drain();
    vi.advanceTimersByTime(1000);

    const delivered = client.statusFrames();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].updates.status).toBe("idle");
    expect(delivered.some((f) => f.updates.status === "streaming")).toBe(false);
  });

  it("discards the debt for a session deleted before its reconcile (X4)", () => {
    const { gateway, manager } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });

    // `unregister` only marks the session ended (the row survives); `remove`
    // is the real deletion the reconcile can collide with.
    manager.remove("s1");
    client.drain();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();

    expect(client.statusFrames()).toHaveLength(0);
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(0);
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
  });

  it("never starts a timer for a socket shedding only transcript events (X5)", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId: "s1" })));
    client.frames.length = 0;
    client.saturate();

    // The incident's exact shape: a flood of non-status transcript frames.
    for (let seq = 1; seq <= 20; seq++) {
      gateway.broadcastEvent("s1", seq, { type: "message_update", text: "x" });
    }

    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
    client.drain();
    vi.advanceTimersByTime(10 * 250);
    // No reconcile machinery ran — the pending-state timer this could have
    // borrowed is never created in this case either.
    expect(client.statusFrames()).toHaveLength(0);
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(0);
  });

  it("reports reconcile counters and occupancy as numeric before any shed (E7)", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    attachCapturedWs(gateway);

    const stats = gateway.getDroppedFrameStats();
    expect(stats.statusReconcileQueued).toBe(0);
    expect(stats.statusReconcileSent).toBe(0);

    const occupancy = gateway.getSocketBufferOccupancy();
    expect(typeof occupancy.max).toBe("number");
    expect(typeof occupancy.p95).toBe("number");
    expect(typeof occupancy.msAboveThreshold).toBe("number");
  });
});

// ── Test injector is inert on a production instance (X6) ────────────────
// `POST /api/test/force-shed` exists so the L3 convergence specs can observe a
// shed at all. Its whole safety argument is the env gate, so the gate is pinned
// here rather than trusted: without `PI_E2E_FORCE_SHED=1` the gateway must
// refuse, not quietly start shedding a real user's frames.
// See change: fix-backpressure-status-and-subagent-frames (test-plan #X6).

describe("test-only shed injector is inert without PI_E2E_FORCE_SHED (X6)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PI_E2E_FORCE_SHED;
  });

  it("refuses to arm, and an under-threshold socket still receives its frames", () => {
    delete process.env.PI_E2E_FORCE_SHED; // the production default
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.drain();

    expect(gateway.setTestForceShed(true)).toBe(false);

    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    expect(client.statusFrames()).toHaveLength(1);
    expect(gateway.getDroppedFrameStats().total).toBe(0);
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
  });

  it("non-vacuity: with the flag set, the same call arms and sheds", () => {
    process.env.PI_E2E_FORCE_SHED = "1";
    const { gateway, manager } = buildDebtGateway(["s1"]);
    manager.update("s1", { status: "streaming" });
    const client = attachCapturedWs(gateway);
    client.drain(); // genuinely UNDER threshold — only the injector sheds here

    expect(gateway.setTestForceShed(true)).toBe(true);

    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    expect(client.statusFrames()).toHaveLength(0);
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))?.owed).toEqual(["s1"]);

    // Releasing it flushes the debt immediately, without waiting for a tick.
    expect(gateway.setTestForceShed(false)).toBe(false);
    expect(client.statusFrames()).toHaveLength(1);
    expect(client.statusFrames()[0].updates.status).toBe("streaming");
  });
});

// ── Counter honesty (review findings 2 + 3) ─────────────────────────────
// Lever B exists so the NEXT incident is attributable. A counter that reports
// a delivery that never happened, or a stall duration of 0 while the stall is
// still running, would make it attributable to the wrong thing.
// See change: fix-backpressure-status-and-subagent-frames.

describe("reconcile + occupancy counters report reality", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does NOT count a reconcile that was itself shed as sent", () => {
    const { gateway, manager } = buildDebtGateway(["s1"]);
    manager.update("s1", { status: "streaming" });
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(0);

    // Under threshold at the flush check, over it by the time `sendTo` looks —
    // the X1 race. The frame never reaches the wire.
    let reads = 0;
    Object.defineProperty(client.ws, "bufferedAmount", {
      configurable: true,
      get: () => (reads++ === 0 ? 0 : TEST_MAX_WS_BUFFER + 1),
      set: () => {},
    });
    vi.advanceTimersByTime(250);

    expect(client.statusFrames()).toHaveLength(0);
    // The id is owed again; counting it sent would report a phantom delivery.
    expect(gateway.getStatusReconcileInfo(asWs(client.ws))?.owed).toEqual(["s1"]);
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(0);

    // Non-vacuity: once it genuinely lands, the counter does move.
    Object.defineProperty(client.ws, "bufferedAmount", { configurable: true, writable: true, value: 0 });
    vi.advanceTimersByTime(250);
    expect(client.statusFrames()).toHaveLength(1);
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(1);
  });

  it("reports msAboveThreshold for a stall that is STILL running", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);

    // Cross the threshold and stay there — the shape of the 6.6 h incident.
    client.saturate();
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });
    vi.advanceTimersByTime(60_000);

    // Accrual happens on the above→below transition, so a read taken DURING the
    // stall must add the open span or it reports 0 for the whole incident.
    const during = gateway.getSocketBufferOccupancy();
    expect(during.msAboveThreshold).toBeGreaterThanOrEqual(60_000);
    expect(during.max).toBeGreaterThan(TEST_MAX_WS_BUFFER);

    // Reading is non-destructive: the span still accrues exactly once on exit.
    client.drain();
    gateway.broadcastSessionUpdated("s1", { status: "idle" });
    const after = gateway.getSocketBufferOccupancy();
    expect(after.msAboveThreshold).toBeGreaterThanOrEqual(60_000);
    expect(after.msAboveThreshold).toBeLessThan(120_000);
  });
});
