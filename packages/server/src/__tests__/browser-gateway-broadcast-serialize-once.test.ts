/**
 * `broadcast()` must serialize its payload **once** per fan-out and reuse the
 * same string for every open subscriber, instead of stringifying per-client.
 * For large recurring payloads (e.g. `openspec_update` on a repo with many
 * changes) per-client stringify is O(payload × subscribers) and contributes
 * directly to event-loop blocking + WS frame delays.
 *
 * Back-pressure (`bufferedAmount > MAX_WS_BUFFER`) and liveness
 * (`readyState !== OPEN`) guards must still apply.
 *
 * See change: scope-openspec-poll-to-active-cwds (broadcast serialize-once).
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function makeFakeWs(opts?: { bufferedAmount?: number; readyState?: number }) {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    bufferedAmount: number;
    OPEN: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = opts?.readyState ?? 1;
  ws.bufferedAmount = opts?.bufferedAmount ?? 0;
  ws.OPEN = 1;
  return ws;
}

function makeStubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}

function buildGateway() {
  return createBrowserGateway(
    createMemorySessionManager(),
    createMemoryEventStore(() => false),
    makeStubPiGateway(),
  );
}

function attach(gateway: ReturnType<typeof buildGateway>, ws: ReturnType<typeof makeFakeWs>) {
  gateway.wss.emit("connection", ws, {});
  // Drain the on-connect bootstrap sends so we can isolate the broadcast frame.
  ws.send.mockClear();
}

const PAYLOAD: ServerToBrowserMessage = {
  // Use a recognized but lightweight message type for the test.
  type: "openspec_update",
  cwd: "/test/cwd",
  data: { initialized: true, changes: [] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// A transcript-class payload for the shed test — since
// fix-connect-snapshot-frame-loss openspec_update is state-class (deferred,
// never shed), so the back-pressure skip is asserted on a transcript frame.
// See change: fix-connect-snapshot-frame-loss (D2).
const TRANSCRIPT_PAYLOAD: ServerToBrowserMessage = {
  type: "session_updated",
  sessionId: "s1",
  updates: { status: "idle" },
} as any;

describe("browser-gateway broadcast serialize-once", () => {
  it("serializes payload exactly once regardless of subscriber count", () => {
    const gateway = buildGateway();
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    const ws3 = makeFakeWs();
    attach(gateway, ws1);
    attach(gateway, ws2);
    attach(gateway, ws3);

    const stringifySpy = vi.spyOn(JSON, "stringify");

    gateway.broadcastToAll(PAYLOAD);

    // Count only stringifications of THIS payload (other code paths may
    // stringify unrelated objects — e.g. logging — so filter by content).
    const payloadCalls = stringifySpy.mock.calls.filter(
      (call) => call[0] === PAYLOAD,
    );
    expect(payloadCalls).toHaveLength(1);

    stringifySpy.mockRestore();
  });

  it("each open socket receives the identical frame", () => {
    const gateway = buildGateway();
    const ws1 = makeFakeWs();
    const ws2 = makeFakeWs();
    const ws3 = makeFakeWs();
    attach(gateway, ws1);
    attach(gateway, ws2);
    attach(gateway, ws3);

    gateway.broadcastToAll(PAYLOAD);

    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(1);
    expect(ws3.send).toHaveBeenCalledTimes(1);

    const f1 = String(ws1.send.mock.calls[0][0]);
    const f2 = String(ws2.send.mock.calls[0][0]);
    const f3 = String(ws3.send.mock.calls[0][0]);
    expect(f1).toBe(f2);
    expect(f2).toBe(f3);
    // And the frame round-trips to the original payload.
    expect(JSON.parse(f1)).toEqual(PAYLOAD);
  });

  it("skips a subscriber whose bufferedAmount exceeds MAX_WS_BUFFER (transcript class)", () => {
    // MAX_WS_BUFFER defaults to 4 MB; mark one socket over that.
    const gateway = buildGateway();
    const wsOk = makeFakeWs();
    const wsFull = makeFakeWs({ bufferedAmount: 8 * 1024 * 1024 });
    attach(gateway, wsOk);
    attach(gateway, wsFull);

    gateway.broadcastToAll(TRANSCRIPT_PAYLOAD);

    expect(wsOk.send).toHaveBeenCalledTimes(1);
    expect(wsFull.send).not.toHaveBeenCalled();
  });

  it("skips a subscriber whose readyState is not OPEN", () => {
    const gateway = buildGateway();
    const wsOpen = makeFakeWs();
    const wsClosed = makeFakeWs({ readyState: 3 /* CLOSED */ });
    attach(gateway, wsOpen);
    attach(gateway, wsClosed);

    gateway.broadcastToAll(PAYLOAD);

    expect(wsOpen.send).toHaveBeenCalledTimes(1);
    expect(wsClosed.send).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Live sessions_reordered windowed at the gateway choke point (D4) — E19, E20.
// See change: fix-connect-snapshot-frame-loss.
//
// `broadcast()` projects `sessionIds` through a fresh `snapshotVisibleIds()`
// BEFORE serialization, so every reorder broadcast site (handlers, wiring,
// reattach placement) emits only ids a fresh snapshot would carry — terminal
// ids and out-of-window ended ids are dropped at one place.
// ─────────────────────────────────────────────────────────────────────────
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { wireEvents } from "../event-wiring.js";
import { applyReattachPolicy } from "../session/reattach-placement.js";
import { createSessionOrderManager } from "../session/session-order-manager.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

/** Minimal prefs store backing a REAL SessionOrderManager. */
function fakePrefs(order: Record<string, string[]>): PreferencesStore {
  let current = order;
  return {
    getPinnedDirectories: () => [],
    setPinnedDirectories: () => {},
    getSessionOrder: () => current,
    setSessionOrder: (o: Record<string, string[]>) => { current = o; },
  } as unknown as PreferencesStore;
}

function row(over: Partial<DashboardSession> & { id: string; cwd: string }): DashboardSession {
  return { source: "tui", status: "active", startedAt: 1_000, hidden: false, ...over } as DashboardSession;
}

/** Registry + real order manager + gateway for the /g group of E19. */
function reorderRig(initialOrder: Record<string, string[]>) {
  const prefs = fakePrefs(initialOrder);
  const orderManager = createSessionOrderManager(prefs);
  const manager = createMemorySessionManager(undefined, orderManager);
  const piGateway = makeStubPiGateway();
  const gateway = createBrowserGateway(
    manager,
    createMemoryEventStore(() => false),
    piGateway,
    undefined,
    undefined,
    orderManager,
    prefs,
  );
  const ws = makeFakeWs();
  gateway.wss.emit("connection", ws, {});
  ws.send.mockClear(); // isolate reorder broadcasts from the bootstrap
  return { manager, orderManager, prefs, piGateway, gateway, ws };
}

const lastReorder = (ws: ReturnType<typeof makeFakeWs>) => {
  const frames = ws.send.mock.calls.map((args) => JSON.parse(String(args[0])) as { type: string; sessionIds?: string[] });
  const reorders = frames.filter((f) => f.type === "sessions_reordered");
  return reorders[reorders.length - 1];
};

/** 120 newer ended sessions elsewhere, so /g's old ended ids sit outside the global window. */
function seedFiller(manager: ReturnType<typeof createMemorySessionManager>): void {
  for (let i = 0; i < 130; i++) {
    manager.restore(row({ id: `fx-${i}`, cwd: `/filler/${i % 4}`, status: "ended", startedAt: 2_000 + i, endedAt: 9_000 + i }));
  }
}

describe("live sessions_reordered windowed at broadcast (E19, E20)", () => {
  it("E19: all three broadcast sites project the order to the snapshot window", () => {
    // live1 mid-list so the event-wiring moveToFront path actually MUTATES
    // (it broadcasts only on change); e4 ended outside the window; t-term a
    // terminal id in the persisted order.
    const rig = reorderRig({ "/g": ["e1", "e2", "e3", "e4", "live1", "t-term"] });
    rig.manager.restore(row({ id: "live1", cwd: "/g" }));
    for (let i = 1; i <= 4; i++) {
      rig.manager.restore(row({ id: `e${i}`, cwd: "/g", status: "ended", startedAt: 1_500 + i, endedAt: 1_600 + i }));
    }
    seedFiller(rig.manager);

    // Site 2 — event-wiring moveToFront path (agent_end + completedFirst).
    wireEvents({
      sessionManager: rig.manager,
      eventStore: createMemoryEventStore(() => false),
      piGateway: rig.piGateway,
      browserGateway: rig.gateway,
      sessionOrderManager: rig.orderManager,
      preferencesStore: rig.prefs,
      pendingForkRegistry: createPendingForkRegistry(),
      directoryService: makeFakeDirectoryService().service,
      knownSessionIds: new Set(["live1", "e1", "e2", "e3", "e4"]),
      pendingDashboardSpawns: new Map(),
      isCompletedFirst: () => true,
    });
    (rig.piGateway as unknown as { onEvent: (sessionId: string, msg: unknown) => void }).onEvent("live1", {
      type: "event_forward",
      sessionId: "live1",
      event: { eventType: "agent_end", timestamp: Date.now(), data: {} },
    });
    expect(lastReorder(rig.ws)?.sessionIds).toEqual(["live1", "e1", "e2", "e3"]);

    // Site 1 — session-meta-handler hide path (moveSessionToFront).
    // Site 1 — a handler-path order mutation broadcast through the gateway.
    // (Manual hide was removed; archive evicts instead of reordering, so this
    // exercises the same `broadcast()` projection directly.)
    rig.orderManager.moveToFront("/g", "live1");
    rig.gateway.broadcast({
      type: "sessions_reordered",
      cwd: "/g",
      sessionIds: rig.orderManager.getOrder("/g") ?? [],
    });
    expect(lastReorder(rig.ws)?.sessionIds).toEqual(["live1", "e1", "e2", "e3"]);

    // Site 3 — reattach placement policy.
    applyReattachPolicy("live1", "/g", "always", {
      sessionManager: rig.manager,
      sessionOrderManager: rig.orderManager,
      browserGateway: rig.gateway,
    });
    expect(lastReorder(rig.ws)?.sessionIds).toEqual(["live1", "e1", "e2", "e3"]);
  });

  it("E20: a session that ends after the snapshot and falls outside the window is projected out", () => {
    const rig = reorderRig({ "/g2": ["f1", "f2", "f3", "live2", "s"] });
    rig.manager.restore(row({ id: "live2", cwd: "/g2" }));
    rig.manager.restore(row({ id: "s", cwd: "/g2", status: "active", startedAt: 1_200 }));
    for (let i = 1; i <= 3; i++) {
      rig.manager.restore(row({ id: `f${i}`, cwd: "/g2", status: "ended", startedAt: 1_500 + i, endedAt: 1_600 + i }));
    }
    seedFiller(rig.manager);

    // s ends AFTER the (conceptual) snapshot and lands 4th in its group's
    // ended sequence — outside the first-3 window; backdate it out of the
    // global window too.
    rig.manager.unregister("s");
    rig.manager.update("s", { endedAt: 1_700 });

    const raw = rig.orderManager.getOrder("/g2");
    expect(raw).toContain("s"); // the raw persisted order still references it

    rig.gateway.broadcast({ type: "sessions_reordered", cwd: "/g2", sessionIds: raw });
    expect(lastReorder(rig.ws)?.sessionIds).toEqual(["f1", "f2", "f3", "live2"]);
  });
});

// ── P2: debt capture adds no per-frame cost to non-status frames ────────
// The dirty-id argument threads through EVERY `fanout` call, and the occupancy
// sample now runs at the shed site, so a regression here taxes the whole
// broadcast hot path.
//
// A literal "same build without the argument" baseline is not constructible
// in-process, so the measured control is the SAME loop over a frame type that
// never enters the debt path: for it the added work is exactly the two guards
// (`msg.type === "session_updated"` in `broadcast`, `dirtyId !== undefined` at
// the shed site). The assertion is that the non-status arm is not more than 5 %
// above a `session_updated` arm whose debt work is fully exercised — i.e. the
// untouched frame types do NOT pay for the feature — plus an absolute
// per-frame ceiling so a heavyweight guard (e.g. a JSON parse) fails loudly.
//
// KNOWN BLIND SPOT: the relative arm cannot see COMMON-MODE cost, i.e. work
// added to both arms. `noteOccupancy` is exactly such a cost. Only the absolute
// per-frame ceiling bounds it, so that ceiling — not the ratio — is what guards
// the occupancy sampler.
//
// See change: fix-backpressure-status-and-subagent-frames (test-plan #P2).
describe("debt capture adds no per-frame cost to the shed path (P2)", () => {
  const ITERATIONS = 10_000;
  /** Generous vs. the ~µs reality; catches an order-of-magnitude regression. */
  const ABSOLUTE_PER_FRAME_BUDGET_MS = 0.05;

  function timeShedLoop(build: (i: number) => ServerToBrowserMessage): number {
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
    );
    const ws = makeFakeWs({ bufferedAmount: 5 * 1024 * 1024 }); // permanently saturated
    gateway.wss.emit("connection", ws, {});

    const frames = Array.from({ length: ITERATIONS }, (_, i) => build(i));
    const t0 = performance.now();
    for (const frame of frames) gateway.broadcastToAll(frame);
    const elapsed = performance.now() - t0;

    expect(gateway.getDroppedFrameStats().total).toBeGreaterThanOrEqual(ITERATIONS);
    return elapsed;
  }

  it("sheds non-status frames no slower than status frames that do the debt work", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Warm-up: let the JIT settle so the comparison is not a tiering artefact.
      timeShedLoop((i) => ({ type: "file_changed", cwd: `/repo/${i % 8}`, path: "a.ts" }) as unknown as ServerToBrowserMessage);
      timeShedLoop((i) => ({ type: "session_updated", sessionId: `s${i % 100}`, updates: { status: "streaming" } }) as ServerToBrowserMessage);

      const nonStatusMs = timeShedLoop(
        (i) => ({ type: "file_changed", cwd: `/repo/${i % 8}`, path: "a.ts" }) as unknown as ServerToBrowserMessage,
      );
      const statusMs = timeShedLoop(
        (i) => ({ type: "session_updated", sessionId: `s${i % 100}`, updates: { status: "streaming" } }) as ServerToBrowserMessage,
      );

      // The untouched frame type must not pay for the feature.
      expect(nonStatusMs).toBeLessThan(statusMs * 1.05);
      // …and neither arm may blow an absolute per-frame ceiling.
      expect(nonStatusMs / ITERATIONS).toBeLessThan(ABSOLUTE_PER_FRAME_BUDGET_MS);
      expect(statusMs / ITERATIONS).toBeLessThan(ABSOLUTE_PER_FRAME_BUDGET_MS);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
