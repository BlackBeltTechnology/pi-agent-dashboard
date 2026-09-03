/**
 * Gateway-boundary contract for the first-class settled-error retry.
 *
 * A browser `retry_session` MUST be routed by the gateway's explicit switch
 * case to the owning session's bridge (`sendToSession`), NOT swallowed by the
 * unknown-type default forwarder. On an undeliverable session (`sendToSession`
 * returns false) the gateway emits a structured `retry_session_error` back to
 * the sender — never a silent drop. This test exercises the real
 * `createBrowserGateway` message loop, so it fails if the `case "retry_session"`
 * is removed (unlike the direct-handler unit test).
 *
 * See change: replace-dashboard-retry-command-with-protocol-message.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

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

function makeGateway(sendToSession: PiGateway["sendToSession"]) {
  const piGateway = {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession,
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
  return createBrowserGateway(
    createMemorySessionManager(),
    createMemoryEventStore(() => false),
    piGateway,
  );
}

async function deliver(ws: EventEmitter, msg: unknown) {
  ws.emit("message", Buffer.from(JSON.stringify(msg)));
  await new Promise((r) => setImmediate(r));
}

describe("gateway routing: retry_session", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("forwards retry_session to the owning bridge (explicit case, not the default)", async () => {
    const sendToSession = vi.fn(() => true) as unknown as PiGateway["sendToSession"];
    const gateway = makeGateway(sendToSession);
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    await deliver(ws, { type: "retry_session", sessionId: "s1" });

    expect(sendToSession).toHaveBeenCalledWith("s1", { type: "retry_session", sessionId: "s1" });
    // Delivered → no negative-ack to the browser.
    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(sent.find((m) => m.type === "retry_session_error")).toBeUndefined();
  });

  it("emits retry_session_error to the sender when the bridge is unreachable", async () => {
    const sendToSession = vi.fn(() => false) as unknown as PiGateway["sendToSession"];
    const gateway = makeGateway(sendToSession);
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    await deliver(ws, { type: "retry_session", sessionId: "gone" });

    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const err = sent.find((m) => m.type === "retry_session_error");
    expect(err, "expected a retry_session_error to the sender").toBeTruthy();
    expect(err).toMatchObject({ type: "retry_session_error", sessionId: "gone" });
    expect(typeof err.error).toBe("string");
  });
});
