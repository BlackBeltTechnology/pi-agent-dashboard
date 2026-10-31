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
    // `register` runs encapsulated-scope callbacks against the same fake
    // (rate-limited flow-file routes; see change: attach-flow-before-run).
    fastify: (() => {
      const f: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; register: (fn: unknown, opts?: unknown) => Promise<void> } = {
        get: vi.fn(),
        put: vi.fn(),
        // Scope callbacks (no options) run; option-bearing plugin
        // registrations (e.g. @fastify/rate-limit) are no-ops here.
        register: async (fn, opts) => {
          if (typeof fn === "function" && opts === undefined) await fn(f);
        },
      };
      return f;
    })(),
    getPluginConfig: () => ({}),
    updatePluginConfig: vi.fn(async () => {}),
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

  it("flow.set-edit-mode is wired to the per-project handler (unknown session: no emit)", async () => {
    const { handler, emitEventToSession, ctx } = await setup();
    handler({ pluginId: "flows", sessionId: "s1", action: "flow.set-edit-mode", payload: { enabled: true } });
    await new Promise((r) => setTimeout(r, 0));
    expect(emitEventToSession).not.toHaveBeenCalled();
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining("flow.set-edit-mode session=s1"));
  });

  it("registers the edit-mode routes and does not touch plugin config without a legacy key", async () => {
    const { ctx } = await setup();
    const f = ctx.fastify as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
    expect(f.get.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(["/api/plugins/flows/edit-mode-default", "/api/plugins/flows/edit-mode-state"]),
    );
    expect(f.put.mock.calls.map((c) => c[0])).toContain("/api/plugins/flows/edit-mode-default");
    expect(ctx.updatePluginConfig).not.toHaveBeenCalled();
  });
});
