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
    const gateway = createBrowserGateway(
      createMemorySessionManager(),
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
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
    // next message (a malformed frame is silently dropped without throwing).
    expect(ws.close).not.toHaveBeenCalled();
    ws.emit("message", Buffer.from("{not json"));
    await new Promise((r) => setImmediate(r));
    // No new handler-error line for the malformed frame (it is dropped, not run).
    const afterCount = errorSpy.mock.calls.filter(
      (args: unknown[]) => typeof args[0] === "string" && args[0].includes("[browser-gw] handler error"),
    ).length;
    expect(afterCount).toBe(1);
  });
});
