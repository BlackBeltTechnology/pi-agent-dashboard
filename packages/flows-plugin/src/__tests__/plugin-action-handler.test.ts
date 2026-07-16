/**
 * flows-plugin plugin_action handler — the production wiring that replaced the
 * v1 logging stub. `flow.run` emits the `flow:run` event pi-flows consumes;
 * `flow.new` launches the manage-flows skill; a missing sessionId is a guarded
 * no-op. See change: fix-plugin-action-fanout-and-handlers.
 */
import { describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../server/index.js";

type Handler = (msg: unknown) => void;

async function setup() {
  const emitEventToSession = vi.fn(() => true);
  const sendToSession = vi.fn(() => true);
  let handler: Handler | undefined;
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcastToSubscribers: vi.fn(),
    emitEventToSession,
    sendToSession,
    provide: vi.fn(),
    consume: vi.fn(),
    sessionManager: { listActive: () => [], listAll: () => [] },
    fastify: { get: vi.fn() },
    registerBrowserHandler: (type: string, h: Handler) => {
      if (type === "plugin_action") handler = h;
    },
  } as unknown as Parameters<typeof registerPlugin>[0];

  await registerPlugin(ctx);
  if (!handler) throw new Error("plugin_action handler not registered");
  return { handler, emitEventToSession, sendToSession, ctx };
}

describe("flows plugin_action handler", () => {
  it("flow.run emits flow:run into the target session (not a stub)", async () => {
    const { handler, emitEventToSession } = await setup();
    handler({ pluginId: "flows", sessionId: "s1", action: "flow.run", payload: { flow: "ns:build", task: "do it" } });
    expect(emitEventToSession).toHaveBeenCalledWith("s1", "flow:run", { flowName: "ns:build", task: "do it" });
  });

  it("flow.new launches the manage-flows skill via sendToSession", async () => {
    const { handler, sendToSession } = await setup();
    handler({ pluginId: "flows", sessionId: "s1", action: "flow.new" });
    expect(sendToSession).toHaveBeenCalledWith("s1", "/skill:manage-flows");
  });

  it("ignores a mismatched pluginId (defense-in-depth) and guards missing sessionId", async () => {
    const { handler, emitEventToSession } = await setup();
    handler({ pluginId: "goal", sessionId: "s1", action: "flow.run", payload: { flow: "ns:x" } });
    handler({ pluginId: "flows", action: "flow.run", payload: { flow: "ns:x" } });
    expect(emitEventToSession).not.toHaveBeenCalled();
  });
});
