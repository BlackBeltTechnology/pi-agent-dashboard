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

  it("skips a subscriber whose bufferedAmount exceeds MAX_WS_BUFFER", () => {
    // MAX_WS_BUFFER defaults to 4 MB; mark one socket over that.
    const gateway = buildGateway();
    const wsOk = makeFakeWs();
    const wsFull = makeFakeWs({ bufferedAmount: 8 * 1024 * 1024 });
    attach(gateway, wsOk);
    attach(gateway, wsFull);

    gateway.broadcastToAll(PAYLOAD);

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
