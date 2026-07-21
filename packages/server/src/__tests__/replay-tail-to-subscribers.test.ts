/**
 * Tasks 2.1 + 2.2 for change: bound-bridge-resume-replay.
 *
 * On a same-id resume the server must NOT dump the whole stored event list in
 * one giant `event_replay` frame (the MAX_WS_BUFFER overflow / silent-drop
 * source). Instead `replayTailToSubscribers` delivers the bounded tail window
 * in back-pressure-aware batches. This suite proves:
 *  - the delivered window is bounded (≤ hard cap), never the full history (2.1)
 *  - a large-fixture resume produces ZERO back-pressure drops (2.2)
 */

import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../browser-gateway.js";
import { TAIL_WINDOW_EVENTS } from "../browser-handlers/select-window.js";
import { createMemoryEventStore } from "../memory-event-store.js";
import { createMemorySessionManager } from "../memory-session-manager.js";
import type { PiGateway } from "../pi-gateway.js";
import { createDrainingWs } from "./helpers/draining-ws.js";

function stubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}

function textEvent(i: number, size = 100): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: Date.now(),
    data: { type: "message_update", text: `${i}:`.padEnd(size, "x") },
  };
}

function subscribe(gateway: ReturnType<typeof createBrowserGateway>, ws: any, sessionId: string) {
  gateway.wss.emit("connection", ws, {});
  ws.drainFully();
  ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId })));
  ws.drainFully();
}

const BATCH = 50;
const HARD_CAP = 2 * TAIL_WINDOW_EVENTS;

describe("replayTailToSubscribers (bounded + batched)", () => {
  it("delivers only the bounded tail window in batches, not the full history", async () => {
    const manager = createMemorySessionManager();
    const store = createMemoryEventStore(() => false);
    const sessionId = "sess-big";
    manager.register({ id: sessionId, cwd: "/repo", source: "tui" });
    const total = TAIL_WINDOW_EVENTS * 5;
    for (let i = 0; i < total; i++) store.insertEvent(sessionId, textEvent(i));

    const gateway = createBrowserGateway(manager, store, stubPiGateway());
    const ws = createDrainingWs({ drainRateBytesPerMs: 50_000 });
    subscribe(gateway, ws, sessionId);
    ws.drainFully();
    const beforeCount = ws.sent.length;

    await gateway.replayTailToSubscribers(sessionId);

    const replayFrames = ws.sent.slice(beforeCount).filter((r) => r.type === "event_replay");
    // Bounded: number of batches never exceeds ceil(hard cap / batch size).
    expect(replayFrames.length).toBeGreaterThan(0);
    expect(replayFrames.length).toBeLessThanOrEqual(Math.ceil(HARD_CAP / BATCH));
    // Full-history delivery would need total/BATCH = 50 frames; bounded ≤ 8.
    expect(replayFrames.length).toBeLessThan(total / BATCH);
  });

  it("produces zero back-pressure drops on a large resume (slow socket)", async () => {
    const manager = createMemorySessionManager();
    const store = createMemoryEventStore(() => false);
    const sessionId = "sess-slow";
    manager.register({ id: sessionId, cwd: "/repo", source: "tui" });
    // ~2 KB/event × bounded ≤400-event window ≈ 800 KB total — stays under the
    // 4 MB MAX_WS_BUFFER precisely BECAUSE the window is bounded. The old
    // full-history frame (3× the window as one JSON blob) would overflow.
    for (let i = 0; i < TAIL_WINDOW_EVENTS * 3; i++) store.insertEvent(sessionId, textEvent(i, 2000));

    const gateway = createBrowserGateway(manager, store, stubPiGateway());
    // Slow drain: the buffer barely clears, so the only thing keeping it under
    // the cap is the bounded window size.
    const ws = createDrainingWs({ drainRateBytesPerMs: 1 });
    subscribe(gateway, ws, sessionId);
    ws.drainFully();

    await gateway.replayTailToSubscribers(sessionId);

    expect(gateway.getDroppedFrameStats().bySession[sessionId] ?? 0).toBe(0);
    expect(gateway.getDroppedFrameStats().total).toBe(0);
    // Peak buffer stayed under the 4 MB cap.
    expect(ws.peakBufferedAmount()).toBeLessThan(4 * 1024 * 1024);
  });

  it("no-ops when there are no subscribers", async () => {
    const manager = createMemorySessionManager();
    const store = createMemoryEventStore(() => false);
    manager.register({ id: "s0", cwd: "/repo", source: "tui" });
    store.insertEvent("s0", textEvent(0));
    const gateway = createBrowserGateway(manager, store, stubPiGateway());
    await expect(gateway.replayTailToSubscribers("s0")).resolves.toBeUndefined();
  });
});
