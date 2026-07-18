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
