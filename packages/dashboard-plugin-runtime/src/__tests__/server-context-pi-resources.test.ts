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

// close-security-map-high-findings (D1, H1; test-plan #E27–#E29): the guarded-read seam is OPTIONAL, forwarded
// verbatim and not trust-gated. The host implementation lives in the server package (`dashboard-state-guard.ts`,
// `agent-credential-guard.test.ts`).
describe("ServerPluginContext.readFileGuarded seam", () => {
  it("reads as undefined on a context built without the dep (an older host): callers must fail closed", () => {
    expect(createServerPluginContext(baseDeps(), "flows").readFileGuarded).toBeUndefined();
  });

  it("forwards the host function verbatim to every plugin id (not trust-gated), including its `null` and rejections", async () => {
    const seen: string[] = [];
    const host = async (p: string): Promise<string | null> => {
      seen.push(p);
      if (p.endsWith("auth.json")) return null;
      if (p.endsWith("missing")) throw Object.assign(new Error("gone"), { code: "ENOENT" });
      return "body";
    };
    for (const id of ["flows", "automation", "some-untrusted-plugin"]) {
      const ctx = createServerPluginContext({ ...baseDeps(), readFileGuarded: host }, id);
      expect(ctx.readFileGuarded).toBe(host);
      await expect(ctx.readFileGuarded?.("/a/auth.json")).resolves.toBeNull();
      await expect(ctx.readFileGuarded?.("/a/ok.txt")).resolves.toBe("body");
      await expect(ctx.readFileGuarded?.("/a/missing")).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(seen).toHaveLength(9);
  });
});
