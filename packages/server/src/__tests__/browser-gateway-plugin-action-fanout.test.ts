/**
 * Contract tests for plugin_action pluginId fan-out.
 *
 * The gateway routes a `plugin_action` message to the handler registered by the
 * plugin whose id matches `message.pluginId`, so multiple plugins service
 * `plugin_action` concurrently without one shadowing another (the old
 * last-writer-wins bug). Unknown pluginId → structured `plugin_action_error` to
 * the sender, never a silent drop.
 *
 * See change: fix-plugin-action-fanout-and-handlers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
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

function makeGateway() {
  return createBrowserGateway(
    createMemorySessionManager(),
    createMemoryEventStore(() => false),
    makeStubPiGateway(),
  );
}

async function deliver(ws: EventEmitter, msg: unknown) {
  ws.emit("message", Buffer.from(JSON.stringify(msg)));
  await new Promise((r) => setImmediate(r));
}

describe("plugin_action pluginId fan-out", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("routes to each plugin's own handler regardless of registration order", async () => {
    const gateway = makeGateway();
    const flowsHandler = vi.fn();
    const goalHandler = vi.fn();

    // Register flows first, goal second — goal must NOT shadow flows.
    gateway.registerPluginActionHandler("flows", flowsHandler);
    gateway.registerPluginActionHandler("goal", goalHandler);

    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    await deliver(ws, { type: "plugin_action", pluginId: "flows", action: "flow.run", sessionId: "s1" });
    await deliver(ws, { type: "plugin_action", pluginId: "goal", action: "pause", sessionId: "s2" });

    expect(flowsHandler).toHaveBeenCalledOnce();
    expect(goalHandler).toHaveBeenCalledOnce();
    expect(flowsHandler.mock.calls[0][0]).toMatchObject({ pluginId: "flows", action: "flow.run" });
    expect(goalHandler.mock.calls[0][0]).toMatchObject({ pluginId: "goal", action: "pause" });
  });

  it("surfaces a structured plugin_action_error for an unknown pluginId (never silent-drops)", async () => {
    const gateway = makeGateway();
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});

    await deliver(ws, { type: "plugin_action", pluginId: "nope", action: "x", sessionId: "s1" });

    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    const err = sent.find((m) => m.type === "plugin_action_error");
    expect(err, "expected a plugin_action_error to the sender").toBeTruthy();
    expect(err).toMatchObject({ type: "plugin_action_error", pluginId: "nope", action: "x" });
    expect(typeof err.error).toBe("string");
  });

  it("warns (does not silently replace) when a pluginId registers twice", () => {
    const gateway = makeGateway();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    gateway.registerPluginActionHandler("dup", vi.fn());
    gateway.registerPluginActionHandler("dup", vi.fn());
    const warned = warnSpy.mock.calls.some(
      (args) => typeof args[0] === "string" && args[0].includes("dup"),
    );
    warnSpy.mockRestore();
    expect(warned).toBe(true);
  });
});
