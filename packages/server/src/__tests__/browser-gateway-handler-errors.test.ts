/**
 * Regression tests for browser-gateway exception handling.
 *
 * - Handler exceptions MUST be logged with a `[browser-gw] handler error`
 *   prefix and the message type, so real bugs (e.g. node-pty spawn
 *   failures) are no longer silently swallowed.
 * - Malformed JSON frames MUST still be silently dropped (no log noise
 *   for garbage input).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { SessionOrderManager } from "../session/session-order-manager.js";

function makeFakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    OPEN: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = 1;
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

function makeStubOrderManager(): SessionOrderManager {
  return {
    insert: vi.fn(),
    remove: vi.fn(),
    getOrder: vi.fn(() => []),
    reorder: vi.fn(),
    getAllOrders: vi.fn(() => ({})),
  } as unknown as SessionOrderManager;
}

describe("browser-gateway handler error reporting", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("logs handler exceptions with type and error (does not silently swallow)", async () => {
    const throwingTerminalManager = {
      spawn: vi.fn(() => {
        throw new Error("posix_spawnp failed.");
      }),
      attach: vi.fn(),
      detach: vi.fn(),
      kill: vi.fn(),
      get: vi.fn(),
      list: vi.fn(() => []),
      updateTitle: vi.fn(),
    } as unknown as TerminalManager;

    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      makeStubOrderManager(),
      undefined,
      undefined,
      throwingTerminalManager,
    );

    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    ws.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "create_terminal", cwd: "/tmp" })),
    );
    // Allow any microtasks to settle.
    await new Promise((r) => setImmediate(r));

    const handlerErrorCall = errorSpy.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("[browser-gw] handler error") &&
        args[0].includes("type=create_terminal"),
    );
    expect(handlerErrorCall, "expected a [browser-gw] handler error log line").toBeTruthy();
    expect(throwingTerminalManager.spawn).toHaveBeenCalledOnce();
  });

  it("silently drops malformed JSON frames (no handler-error log)", async () => {
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
    );

    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    ws.emit("message", Buffer.from("{not json"));
    await new Promise((r) => setImmediate(r));

    const handlerErrorCall = errorSpy.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" && args[0].includes("[browser-gw] handler error"),
    );
    expect(handlerErrorCall).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pending-state flush fault injection (D2) — X3, X4.
// See change: fix-connect-snapshot-frame-loss.
// ─────────────────────────────────────────────────────────────────────────

/** Fake ws whose send records frames + callbacks; terminate closes like ws. */
function makeStateWs() {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    OPEN: number;
    bufferedAmount: number;
    frames: string[];
    callbacks: Array<(err?: Error | null) => void>;
    terminateCount: number;
    sendError?: Error;
    send: (data: string, cb?: (err?: Error | null) => void) => void;
    terminate: () => void;
  };
  ws.readyState = 1;
  ws.OPEN = 1;
  ws.bufferedAmount = 0;
  ws.frames = [];
  ws.callbacks = [];
  ws.terminateCount = 0;
  ws.send = (data, cb) => {
    ws.frames.push(data);
    if (cb) {
      ws.callbacks.push(cb);
      if (ws.sendError) cb(ws.sendError); // fault: synchronous send failure
    }
  };
  ws.terminate = () => {
    ws.terminateCount++;
    ws.readyState = 3;
  };
  return ws;
}

/** `git_head_update` whose serialized frame is exactly `bytes` UTF-8 bytes. */
function gitHeadSized(cwd: string, bytes: number): ServerToBrowserMessage {
  for (let pad = 0; pad < bytes; pad++) {
    const msg = { type: "git_head_update", cwd, branch: "b".repeat(pad) };
    if (Buffer.byteLength(JSON.stringify(msg)) === bytes) return msg as ServerToBrowserMessage;
  }
  throw new Error(`cannot hit ${bytes} bytes`);
}

type StateWs = ReturnType<typeof makeStateWs>;

/** The fake satisfies the gateway's `WebSocket` surface at runtime; bridge the type. */
const asWs = (w: StateWs) => w as unknown as import("ws").WebSocket;

describe("browser-gateway pending-state flush fault injection", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function stateRig(maxWsBufferBytes: number) {
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      maxWsBufferBytes,
    );
    const ws = makeStateWs();
    gateway.wss.emit("connection", ws, {});
    const base = ws.frames.length;
    return { gateway, ws, base };
  }

  it("X3: a send callback invoked with an error logs rate-limited, never re-sends the entry, does not throw", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws, base } = stateRig(1000);
      ws.bufferedAmount = 1001;
      gateway.sendToClient(asWs(ws), gitHeadSized("/a", 200));
      gateway.sendToClient(asWs(ws), gitHeadSized("/b", 200));

      // Every send's callback now fails synchronously (fault injection).
      ws.sendError = new Error("boom");
      ws.bufferedAmount = 0;
      vi.advanceTimersByTime(250); // periodic flush attempts both entries

      // Each pending entry attempted exactly once (2 frames), never re-sent.
      expect(ws.frames.length).toBe(base + 2);
      // One rate-limited warning, not one per failed frame.
      const flushWarns = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes("state flush"));
      expect(flushWarns.length).toBe(1);
      // The map is drained (entries removed before send; errors do not resurrect them).
      expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("X4: ceiling terminate while a flush timer is pending — tick is guarded and cleared", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws, base } = stateRig(1000);
      ws.bufferedAmount = 1001;
      gateway.sendToClient(asWs(ws), gitHeadSized("/a", 200)); // defers + starts the timer
      expect(vi.getTimerCount()).toBe(1);

      // A second, over-ceiling deferral terminates the socket and drops the map.
      gateway.sendToClient(asWs(ws), gitHeadSized("/b", 900));
      expect(ws.terminateCount).toBe(1);
      expect(ws.readyState).toBe(3);
      expect(vi.getTimerCount()).toBe(0); // timer cleared with the map

      // The pending timer tick (if any survived) must not send on a dead socket.
      vi.advanceTimersByTime(1000);
      expect(ws.frames.length).toBe(base);
    } finally {
      vi.useRealTimers();
    }
  });
});
