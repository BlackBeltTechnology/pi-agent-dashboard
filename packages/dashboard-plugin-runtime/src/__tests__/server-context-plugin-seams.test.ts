/**
 * credentials / oauth / registerPiRequestHandler seams on ServerPluginContext:
 * each is bound to the calling plugin's manifest id and optional.
 * See change: expose-plugin-credential-and-oauth-seams (tasks 2.2, 3.2, 4.2).
 */
import { describe, expect, it, vi } from "vitest";
import {
  createServerPluginContext,
  type PluginCredentialRecord,
  type PluginCredentials,
  PluginFlowStartError,
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
    onSessionResolved: () => () => {},
    sendToSession: () => true,
    emitEventToSession: () => true,
    sendExtensionMessage: () => false,
    consumeAll: () => [],
    spawnSession: async () => ({ success: true }),
    abortSession: () => true,
    abortSpawnedRun: async () => false,
    registerCwdPolicy: () => {},
    unregisterCwdPolicy: () => {},
    provide: () => {},
    consume: () => undefined,
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
    mintSpawnToken: () => "tok-test",
    renameSession: () => false,
    assignSessionRef: () => false,
    networkGuard: async () => {},
    onShutdown: () => () => {},
  };
}

/** In-memory stand-in for the host store, partitioned by plugin id. */
function memoryCredentials() {
  const data = new Map<string, Map<string, PluginCredentialRecord>>();
  return (pluginId: string): PluginCredentials => {
    const ns = () => data.get(pluginId) ?? data.set(pluginId, new Map()).get(pluginId)!;
    return {
      get: async (k) => ns().get(k),
      list: async () => [...ns().keys()],
      snapshot: async () => Object.fromEntries(ns()),
      set: async (k, r) => { ns().set(k, r); },
      remove: async (k) => { ns().delete(k); },
      update: async (k, fn) => {
        const next = await fn(ns().get(k));
        if (next === undefined) ns().delete(k); else ns().set(k, next);
        return next;
      },
    };
  };
}

describe("ServerPluginContext credentials", () => {
  it("binds the store to each plugin's own id — two contexts cannot see each other", async () => {
    const factory = vi.fn(memoryCredentials());
    const deps = { ...baseDeps(), pluginCredentials: factory };
    const gmail = createServerPluginContext(deps, "gmail");
    const other = createServerPluginContext(deps, "other");
    await gmail.credentials!.set("a@x.com", { refresh: "r" });
    expect(await other.credentials!.list()).toEqual([]);
    expect(await other.credentials!.get("a@x.com")).toBeUndefined();
    expect(await gmail.credentials!.list()).toEqual(["a@x.com"]);
    expect(factory.mock.calls.map((c) => c[0])).toEqual(["gmail", "other"]);
  });

  it("is absent when the host does not wire it", () => {
    const ctx = createServerPluginContext(baseDeps(), "p");
    expect(ctx.credentials).toBeUndefined();
    expect(ctx.oauth).toBeUndefined();
    expect(ctx.registerPiRequestHandler).toBeUndefined();
  });
});

describe("ServerPluginContext oauth", () => {
  const loginFlow = { name: "Fake", login: async () => ({ type: "oauth" as const, refresh: "r", access: "a", expires: 1 }) };

  it("forwards the plugin id and returns the flow id", async () => {
    const start = vi.fn(async () => ({ ok: true as const, flowId: "f1" }));
    const ctx = createServerPluginContext({ ...baseDeps(), startPluginOAuthFlow: start }, "gmail");
    const persist = async () => {};
    await expect(ctx.oauth!.startFlow({ key: "k", loginFlow, persist })).resolves.toEqual({ flowId: "f1" });
    expect(start).toHaveBeenCalledWith("gmail", { key: "k", loginFlow, persist });
  });

  it("maps a host failure to PluginFlowStartError", async () => {
    const start = async () => ({ ok: false as const, code: "start_timeout" as const, message: "Provider did not respond" });
    const ctx = createServerPluginContext({ ...baseDeps(), startPluginOAuthFlow: start }, "gmail");
    const err = await ctx.oauth!.startFlow({ key: "k", loginFlow, persist: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(PluginFlowStartError);
    expect(err).toMatchObject({ code: "start_timeout" });
  });
});

describe("ServerPluginContext registerPiRequestHandler", () => {
  it("registers under the calling plugin's id", () => {
    const register = vi.fn();
    const ctx = createServerPluginContext({ ...baseDeps(), registerPiRequestHandler: register }, "gmail");
    const handler = () => ({ t: 1 });
    ctx.registerPiRequestHandler!("lease", handler);
    expect(register).toHaveBeenCalledWith("gmail", "lease", handler);
  });
});
