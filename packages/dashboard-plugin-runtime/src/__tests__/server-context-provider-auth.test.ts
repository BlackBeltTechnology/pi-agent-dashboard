/**
 * providerAuth seam on ServerPluginContext.
 *
 * Replaces plugins deep-importing `pi-dashboard-server/src/auth/
 * provider-auth-storage.js` — a plugin published to npm has no server source
 * tree to reach into. Optional: the host withholds it from untrusted plugins,
 * so a plugin must degrade rather than assume it.
 * See change: publish-quota-plugin.
 */
import { describe, expect, it } from "vitest";
import {
  createServerPluginContext,
  type PluginProviderAuth,
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
    registerCwdPolicy: () => {},
    unregisterCwdPolicy: () => {},
    provide: () => {},
    consume: () => undefined,
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
  };
}

describe("ServerPluginContext providerAuth", () => {
  it("passes an injected providerAuth through to the context", () => {
    const providerAuth: PluginProviderAuth = {
      getCredential: (provider) =>
        provider === "anthropic"
          ? { type: "oauth", refresh: "r", access: "a", expires: 1 }
          : undefined,
    };
    const ctx = createServerPluginContext({ ...baseDeps(), providerAuth }, "quota");
    expect(ctx.providerAuth).toBe(providerAuth);
    expect(ctx.providerAuth?.getCredential("anthropic")).toMatchObject({ type: "oauth" });
  });

  it("returns undefined for a provider with no stored credential", () => {
    const providerAuth: PluginProviderAuth = { getCredential: () => undefined };
    const ctx = createServerPluginContext({ ...baseDeps(), providerAuth }, "quota");
    expect(ctx.providerAuth?.getCredential("openai")).toBeUndefined();
  });

  it("is absent when the host withholds it (untrusted plugin)", () => {
    const ctx = createServerPluginContext(baseDeps(), "third-party-plugin");
    expect(ctx.providerAuth).toBeUndefined();
    // Consumers must optional-chain rather than assume the seam exists.
    expect(ctx.providerAuth?.getCredential("anthropic")).toBeUndefined();
  });
});
