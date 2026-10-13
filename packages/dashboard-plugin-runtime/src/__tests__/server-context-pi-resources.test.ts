/**
 * L1 — `ServerPluginContext.getPiResources` / `onPiResourcesInvalidated`
 * capability typing (dashboard-plugin-loader delta). Both optional: absent dep
 * reads `undefined`; present dep is forwarded verbatim.
 * See change: add-skill-atlas-screen.
 */
import { describe, expect, it } from "vitest";
import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
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
    sendExtensionMessage: () => false,
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

describe("ServerPluginContext pi-resources seams", () => {
  it("read as undefined on a context built without the deps", () => {
    const ctx = createServerPluginContext(baseDeps(), "skill-atlas");
    expect(ctx.getPiResources).toBeUndefined();
    expect(ctx.onPiResourcesInvalidated).toBeUndefined();
  });

  it("forwards both deps verbatim", async () => {
    const result = { local: {}, global: {}, packages: [] } as unknown as PiResourcesResult;
    const calls: Array<[string | undefined, { fresh?: boolean } | undefined]> = [];
    const unsub = () => {};
    const ctx = createServerPluginContext(
      {
        ...baseDeps(),
        getPiResources: async (cwd, opts) => {
          calls.push([cwd, opts]);
          return result;
        },
        onPiResourcesInvalidated: () => unsub,
      },
      "skill-atlas",
    );
    await expect(ctx.getPiResources?.("/repo", { fresh: true })).resolves.toBe(result);
    expect(calls).toEqual([["/repo", { fresh: true }]]);
    expect(ctx.onPiResourcesInvalidated?.(() => {})).toBe(unsub);
  });
});
