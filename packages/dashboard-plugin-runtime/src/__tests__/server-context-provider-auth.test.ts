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
import { createGatedProviderAuth, isFirstPartyPluginPackage } from "../server/first-party.js";

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

// See change: promote-model-roles-settings (test-plan #E11) — the scope gate
// is the shared `isFirstPartyPluginPackage` helper; behaviour unchanged.

describe("first-party providerAuth gate", () => {
  const auth = { anthropic: { type: "oauth", access: "a" } };

  it("withholds credentials from a non-scoped plugin", () => {
    expect(createGatedProviderAuth("acme-x", () => auth).getCredential("anthropic")).toBeUndefined();
  });

  it("returns the auth.json entry to a first-party plugin", () => {
    expect(
      createGatedProviderAuth("@blackbelt-technology/y", () => auth).getCredential("anthropic"),
    ).toEqual({ type: "oauth", access: "a" });
  });

  it("degrades to undefined when auth.json cannot be read", () => {
    const pa = createGatedProviderAuth("@blackbelt-technology/y", () => {
      throw new Error("EACCES");
    });
    expect(pa.getCredential("anthropic")).toBeUndefined();
  });

  it("predicate: scope prefix only; empty name is not first-party", () => {
    expect(isFirstPartyPluginPackage("@blackbelt-technology/pi-dashboard-roles-plugin")).toBe(true);
    expect(isFirstPartyPluginPackage("acme-dashboard-x")).toBe(false);
    expect(isFirstPartyPluginPackage("")).toBe(false);
    expect(isFirstPartyPluginPackage(undefined)).toBe(false);
  });
});
