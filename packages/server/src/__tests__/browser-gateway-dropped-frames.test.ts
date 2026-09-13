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
import type { DrainingWs } from "./helpers/draining-ws.js";
import { buildLoadGateway, makeStubPiGateway, seedSessions, subscribeWs } from "./helpers/load-fixtures.js";

const MAX_WS_BUFFER = 4 * 1024 * 1024; // gateway default

/** The draining fake satisfies the gateway's `WebSocket` surface at runtime. */
const asWs = (w: DrainingWs) => w as unknown as import("ws").WebSocket;

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
    expect(frameClassOf(asMsg({ type: "openspec_get_result", cwd: "/a" }))).toEqual({ cls: "state", key: "openspec_get_result:/a" });
    expect(frameClassOf(asMsg({ type: "git_head_update", cwd: "/a", branch: "develop" }))).toEqual({ cls: "state", key: "git_head_update:/a" });
    expect(frameClassOf(asMsg({ type: "sessions_page_result", cwd: "/a" }))).toEqual({ cls: "state", key: "sessions_page_result:/a" });
    // Same cwd, DIFFERENT keys — the type is always part of the key.
    expect(frameClassOf(asMsg({ type: "openspec_update", cwd: "/a" })).key).not.toBe(
      frameClassOf(asMsg({ type: "git_head_update", cwd: "/a", branch: "develop" })).key,
    );
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
