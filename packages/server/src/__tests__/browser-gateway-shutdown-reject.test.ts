/**
 * A rejecting `handleShutdown` on a `shutdown` message must reach the
 * dispatch-level try/catch in `browser-gateway`'s `ws.on("message")` handler
 * (the `shutdown` case is now `await`ed), rather than floating as an unhandled
 * rejection. The connection stays open, so shutdown reaches a terminal state
 * and the next message is still processed.
 *
 * Harness idiom mirrors `browser-gateway-handler-errors.test.ts`.
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #X12).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { asWs, attachCapturedWs, buildDebtGateway } from "./helpers/status-debt-fixtures.js";

// Reject only `handleShutdown`; every other handler the gateway imports keeps
// its real implementation.
vi.mock("../browser-handlers/session-action-handler.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../browser-handlers/session-action-handler.js")>();
  return {
    ...actual,
    handleShutdown: vi.fn(async () => {
      throw new Error("shutdown boom");
    }),
  };
});

import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";

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

describe("browser-gateway — shutdown handler rejection is owned", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("X12 a rejected handleShutdown reaches the dispatch catch; no unhandled rejection; next message still handled", async () => {
    const piGateway = makeStubPiGateway();
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      piGateway,
    );
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    ws.emit("message", Buffer.from(JSON.stringify({ type: "shutdown", sessionId: "s1" })));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const shutdownError = errorSpy.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === "string" &&
        args[0].includes("[browser-gw] handler error") &&
        args[0].includes("type=shutdown"),
    );
    expect(shutdownError, "expected a [browser-gw] handler error type=shutdown line").toBeTruthy();
    expect(unhandled).toEqual([]);

    // Terminal state: the connection is not closed and still dispatches the
    // NEXT valid message. The mocked `handleShutdown` throws before touching
    // `piGateway`, so no dispatch effect exists yet — then a valid `subscribe`
    // fans metadata requests out via `piGateway.sendToSession`, an observable
    // effect proving the handler loop kept running after the rejected shutdown.
    expect(ws.close).not.toHaveBeenCalled();
    expect(piGateway.sendToSession).not.toHaveBeenCalled();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId: "s2" })));
    await new Promise((r) => setImmediate(r));
    expect(piGateway.sendToSession).toHaveBeenCalled();
    // The subscribe dispatched cleanly — no new handler-error line.
    const afterCount = errorSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === "string" && args[0].includes("[browser-gw] handler error"),
    ).length;
    expect(afterCount).toBe(1);
  });
});

// ── Status-reconcile teardown on close (X2) ─────────────────────────────
// A closed socket can never receive its owed reconciles; the set AND the
// interval serving it must go with it, or the gateway leaks a timer per
// disconnect. See change: fix-backpressure-status-and-subagent-frames.

describe("socket close releases the status-reconcile debt (X2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drops the set and clears the interval; no callback fires afterwards", () => {
    const { gateway } = buildDebtGateway(["s1"]);
    const client = attachCapturedWs(gateway);
    client.saturate();
    gateway.broadcastSessionUpdated("s1", { status: "streaming" });

    const before = gateway.getStatusReconcileInfo(asWs(client.ws));
    expect(before?.owed).toEqual(["s1"]);
    expect(before?.timerActive).toBe(true);

    client.ws.close();

    expect(gateway.getStatusReconcileInfo(asWs(client.ws))).toBeUndefined();
    // Drain and let 10 intervals elapse: a surviving timer would fire here.
    client.drain();
    vi.advanceTimersByTime(10 * 250);
    expect(client.statusFrames()).toHaveLength(0);
    expect(gateway.getDroppedFrameStats().statusReconcileSent).toBe(0);
  });
});
