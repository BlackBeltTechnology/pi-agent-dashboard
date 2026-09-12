/**
 * L1 — `ServerPluginContext.isPiExtensionInstalled` capability typing
 * (dashboard-plugin-loader delta; tasks 2.1).
 *
 * The capability is OPTIONAL: a context built without the dep must yield
 * `undefined` on read (never throw), and a context built with it must forward
 * the host's hook verbatim.
 *
 * See change: add-blackhole-session-pipeline.
 */
import { describe, expect, it } from "vitest";
import {
  createServerPluginContext,
  type ServerContextDeps,
} from "../server/server-context.js";

function baseDeps(): ServerContextDeps {
  return {
    fastify: {} as ServerContextDeps["fastify"],
    sessionManager: {
      listActive: () => [],
      listAll: () => [],
      getSession: () => undefined,
    },
    eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
    broadcastToSubscribers: () => {},
    registerPiHandler: () => {},
    registerBrowserHandler: () => {},
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    onSessionResolved: () => () => {},
    sendToSession: () => false,
    emitEventToSession: () => false,
    spawnSession: async () => ({ success: false }),
    abortSession: () => false,
    abortSpawnedRun: async () => false,
    registerCwdPolicy: () => {},
    unregisterCwdPolicy: () => {},
    provide: () => {},
    consume: () => undefined,
    consumeAll: () => [],
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
    mintSpawnToken: () => "tok-test",
    renameSession: () => false,
    assignSessionRef: () => false,
    networkGuard: async () => {},
    onShutdown: () => () => {},
  };
}

describe("ServerPluginContext.isPiExtensionInstalled", () => {
  it("reads as undefined (no throw) on a context built without the dep", () => {
    const ctx = createServerPluginContext(baseDeps(), "probe-consumer");
    expect(ctx.isPiExtensionInstalled).toBeUndefined();
  });

  it("forwards the dep when the host provides it", async () => {
    const calls: string[] = [];
    const ctx = createServerPluginContext(
      {
        ...baseDeps(),
        isPiExtensionInstalled: async (name) => {
          calls.push(name);
          return name === "pi-blackhole";
        },
      },
      "probe-consumer",
    );
    expect(await ctx.isPiExtensionInstalled?.("pi-blackhole")).toBe(true);
    expect(await ctx.isPiExtensionInstalled?.("not-installed-ext")).toBe(false);
    expect(calls).toEqual(["pi-blackhole", "not-installed-ext"]);
  });
});
