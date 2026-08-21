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
import { createDrainingWs } from "./helpers/draining-ws.js";
import { buildLoadGateway, seedSessions, subscribeWs } from "./helpers/load-fixtures.js";

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

  it("drops the over-cap frame and terminates only that socket for resynchronization", () => {
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    const ws = overloadSocket(gateway, seed.focusedSessionId);
    const terminate = vi.fn(() => ws.close());
    Object.assign(ws, { terminate });

    const healthy = createDrainingWs({ drainRateBytesPerMs: 50_000 });
    const healthyTerminate = vi.fn(() => healthy.close());
    Object.assign(healthy, { terminate: healthyTerminate });
    subscribeWs(gateway, healthy, seed.focusedSessionId);
    healthy.drainFully();

    expect(ws.peakBufferedAmount()).toBeGreaterThan(MAX_WS_BUFFER);
    const overloadedSentBefore = ws.sent.length;
    const healthySentBefore = healthy.sent.length;

    // The NEXT ordinary event for this session crosses the guard.
    gateway.broadcastEvent(seed.focusedSessionId, 2, { type: "message_update", text: "ordinary-stream-update" });

    // The over-cap socket misses the frame, but cannot remain silently stale.
    expect(ws.sent).toHaveLength(overloadedSentBefore);
    expect(terminate).toHaveBeenCalledOnce();

    // Healthy subscribers stay live and receive the same frame.
    expect(healthy.sent.length).toBeGreaterThan(healthySentBefore);
    expect(healthyTerminate).not.toHaveBeenCalled();

    // Recovery is observable beside the existing drop attribution.
    const stats = gateway.getDroppedFrameStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.bySession[seed.focusedSessionId]).toBeGreaterThanOrEqual(1);
    expect(stats.forcedReconnects).toBe(1);
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
    expect(msg).toContain("forcing reconnect/replay");
  });

  it("bounds a drop storm to one warning and one recovery per affected socket", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    const ws = overloadSocket(gateway, seed.focusedSessionId);
    const terminate = vi.fn();
    Object.assign(ws, { terminate });

    // Keep readyState OPEN to model frames already in flight before the close
    // callback changes socket state.
    for (let seq = 2; seq < 20; seq++) {
      gateway.broadcastEvent(seed.focusedSessionId, seq, { type: "tool_execution_end", data: { toolCallId: `t${seq}` } });
    }

    const dropWarns = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("dropped frame"));
    expect(dropWarns).toHaveLength(1);
    expect(terminate).toHaveBeenCalledOnce();
    expect(gateway.getDroppedFrameStats()).toMatchObject({
      total: 18,
      forcedReconnects: 1,
    });
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
