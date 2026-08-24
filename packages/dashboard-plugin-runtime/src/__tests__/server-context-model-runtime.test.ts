/**
 * modelRuntime seam on ServerPluginContext.
 *
 * A plugin server entry can run completions through the dashboard's in-process
 * registry + streamSimple (credentials resolved server-side) instead of a
 * loopback HTTP hop. Optional — absent when the model proxy is unavailable, so
 * a plugin must degrade rather than assume it. See change:
 * make-grammar-fully-plugin-contained.
 */
import { describe, expect, it } from "vitest";
import {
  createServerPluginContext,
  type PluginModelRuntime,
  type ServerContextDeps,
} from "../server/server-context.js";

function baseDeps(): ServerContextDeps {
  return {
    fastify: {} as ServerContextDeps["fastify"],
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
    broadcastToSubscribers: () => {},
    registerPiHandler: () => {},
    registerBrowserHandler: () => {},
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    sendToSession: () => true,
    emitEventToSession: () => true,
    consumeAll: () => [],
    spawnSession: async () => ({ success: true }),
    abortSession: () => true,
    abortSpawnedRun: async () => false,
    provide: () => {},
    consume: () => undefined,
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
  };
}

describe("ServerPluginContext modelRuntime", () => {
  it("passes an injected modelRuntime through to the context", async () => {
    const runtime: PluginModelRuntime = {
      getModelRegistry: async () => ({
        find: async (provider, id) => ({ provider, id }),
        getApiKeyAndHeaders: async () => ({ apiKey: "k", headers: {} }),
      }),
      streamSimple: () =>
        (async function* () {
          yield { type: "done", message: { content: "ok" } };
        })(),
    };
    const ctx = createServerPluginContext({ ...baseDeps(), modelRuntime: runtime }, "grammar");
    expect(ctx.modelRuntime).toBe(runtime);
    const registry = await ctx.modelRuntime?.getModelRegistry();
    expect(await registry?.find("google", "gemini-flash-latest")).toEqual({
      provider: "google",
      id: "gemini-flash-latest",
    });
  });

  it("is undefined when the host injects no model runtime (degraded mode)", () => {
    const ctx = createServerPluginContext(baseDeps(), "grammar");
    expect(ctx.modelRuntime).toBeUndefined();
  });
});
