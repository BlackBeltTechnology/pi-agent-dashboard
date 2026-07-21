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

describe("dropped-frame threshold notice (D4)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits one frames_dropped notice after the drop count crosses the threshold, not per drop", () => {
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    const ws = overloadSocket(gateway, seed.focusedSessionId);

    // Drive a storm of drops well past the threshold (5).
    for (let seq = 2; seq < 30; seq++) {
      gateway.broadcastEvent(seed.focusedSessionId, seq, { type: "tool_execution_end", data: { toolCallId: `t${seq}` } });
    }

    const notices = ws.sent.filter((r) => r.type === "frames_dropped");
    // Exactly one notice for the session despite many drops.
    expect(notices.length).toBe(1);
    expect(notices[0].sessionId).toBe(seed.focusedSessionId);
  });

  it("does NOT emit a notice below the threshold", () => {
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const gateway = buildLoadGateway(seed.manager);
    const ws = overloadSocket(gateway, seed.focusedSessionId);

    // Only 3 drops (< threshold of 5).
    for (let seq = 2; seq < 5; seq++) {
      gateway.broadcastEvent(seed.focusedSessionId, seq, { type: "tool_execution_end", data: { toolCallId: `t${seq}` } });
    }

    expect(ws.sent.filter((r) => r.type === "frames_dropped").length).toBe(0);
  });
});
