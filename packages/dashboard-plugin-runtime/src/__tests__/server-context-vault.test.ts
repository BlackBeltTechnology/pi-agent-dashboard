/**
 * `vaultBindings` manifest declaration + the `vault` seam on ServerPluginContext:
 * bound to the calling plugin's id, absent when the host does not wire it.
 * See change: add-credential-vault (task 3.19, test-plan E19).
 */
import { describe, expect, it, vi } from "vitest";
import { ManifestValidationError, validateManifest } from "../manifest-validator.js";
import { createServerPluginContext, type PluginVault, type ServerContextDeps } from "../server/server-context.js";

const base = { id: "deck3d", displayName: "Deck3D", claims: [] };

describe("manifest.vaultBindings", () => {
  it("absent by default", () => {
    expect(validateManifest(base).vaultBindings).toBeUndefined();
  });
  it("accepts a list of env-style names", () => {
    expect(validateManifest({ ...base, vaultBindings: ["POLY_PIZZA_KEY", "GEMINI_API_KEY"] }).vaultBindings).toEqual(["POLY_PIZZA_KEY", "GEMINI_API_KEY"]);
  });
  it.each([["a string", "POLY_PIZZA_KEY"], ["a non-string entry", ["OK_KEY", 3]], ["an invalid name", ["poly pizza"]]])("rejects %s", (_l, v) => {
    expect(() => validateManifest({ ...base, vaultBindings: v })).toThrow(ManifestValidationError);
  });
});

describe("ServerPluginContext.vault", () => {
  const deps = (extra: Partial<ServerContextDeps>): ServerContextDeps => ({
    fastify: {} as ServerContextDeps["fastify"],
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
    broadcastToSubscribers: () => {}, registerPiHandler: () => {}, registerBrowserHandler: () => {},
    onEvent: () => () => {}, onSessionEnded: () => () => {}, onSessionResolved: () => () => {},
    sendToSession: () => true, emitEventToSession: () => true, sendExtensionMessage: () => false,
    consumeAll: () => [], spawnSession: async () => ({ success: true }), abortSession: () => true,
    abortSpawnedRun: async () => false, registerCwdPolicy: () => {}, unregisterCwdPolicy: () => {},
    provide: () => {}, consume: () => undefined, getPluginConfig: () => ({}), updatePluginConfig: async () => {},
    mintSpawnToken: () => "tok", renameSession: () => false, assignSessionRef: () => false,
    networkGuard: async () => {}, onShutdown: () => () => {},
    ...extra,
  });

  it("is absent when the host does not wire it", () => {
    expect(createServerPluginContext(deps({}), "p").vault).toBeUndefined();
  });

  it("binds the reader to the calling plugin's id", async () => {
    const factory = vi.fn((id: string): PluginVault => ({ read: async (n) => `${id}:${n}` }));
    const d = deps({ pluginVault: factory });
    const a = createServerPluginContext(d, "a");
    const b = createServerPluginContext(d, "b");
    expect(await a.vault!.read("X_KEY")).toBe("a:X_KEY");
    expect(await b.vault!.read("X_KEY")).toBe("b:X_KEY");
    expect(factory.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
  });
});
