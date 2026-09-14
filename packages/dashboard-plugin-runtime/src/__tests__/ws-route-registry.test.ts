/**
 * Plugin WS route registry — decision tables for registration, reservation
 * and the activation window (test-plan #E1–#E3, spec plugin-ws-route).
 *
 * Drives the REAL loader (`loadServerEntries` over committed fixture plugins
 * in `fixtures/ws-route-plugins/`) so the activation-window semantics are the
 * ones production uses, not a hand-mirrored copy. (Temp-dir entries cannot be
 * used: vitest's module runner refuses dynamic imports outside the source
 * tree — see loader.test.ts's note.)
 *
 * See change: add-browser-relay (group 1).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredPlugin } from "../server/loader.js";
import {
  clearDiscoveryCache,
  clearStatusStore,
  getPluginStatusStore,
  loadServerEntries,
} from "../server/loader.js";
import type { ServerContextDeps, ServerPluginContext } from "../server/server-context.js";
import { createServerPluginContext } from "../server/server-context.js";
import {
  clearWsRouteRegistry,
  getWsRouteRegistry,
  type WsSocketLike,
} from "../server/ws-route-registry.js";

const FIXTURES_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "ws-route-plugins",
);

/** Full ServerContextDeps stub — the real factory binds registerWsRoute over it. */
const makeDeps = (): ServerContextDeps => ({
  fastify: {} as never,
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
});

const deps = makeDeps();

function createContext(plugin: DiscoveredPlugin): ServerPluginContext {
  return createServerPluginContext(deps, plugin.manifest.id);
}

const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  clearDiscoveryCache();
  clearStatusStore();
  clearWsRouteRegistry();
});

afterEach(() => {
  clearDiscoveryCache();
  clearStatusStore();
  clearWsRouteRegistry();
});

/** Load the fixture plugins whose ids `isEnabled` admits. */
const load = async (isEnabled: (id: string) => boolean) =>
  loadServerEntries({ createContext, isEnabled, repoRoot: FIXTURES_ROOT });

const only = (...ids: string[]) => {
  const set = new Set(ids);
  return (id: string) => set.has(id);
};

// ─── #E1 — duplicate scope / nested prefix throw, first stays active ───────
describe("#E1 duplicate scope or prefix", () => {
  it("throws for both, marks the plugins failed, keeps A resolving", async () => {
    await load(only("good-ext", "dup-scope", "nested-prefix"));

    const registry = getWsRouteRegistry();
    // A's registration is still active and resolves its prefix.
    expect(registry.resolveScope("/ws/browser-ext/abc")).toBe("browser-ext");
    expect(registry.get("browser-ext")?.pluginId).toBe("good-ext");

    // B (duplicate scope) and C (nested prefix) are marked failed in the
    // status store — the source of /api/health.plugins[].
    const store = getPluginStatusStore();
    expect(store.getStatus("good-ext")?.loaded).toBe(true);
    expect(store.getStatus("dup-scope")?.loaded).toBe(false);
    expect(store.getStatus("dup-scope")?.error).toContain("already registered");
    expect(store.getStatus("nested-prefix")?.loaded).toBe(false);
    expect(store.getStatus("nested-prefix")?.error).toContain("overlaps");
  });

  it("also throws when an EXISTING prefix would nest under the NEW one", async () => {
    // Discovery order is (priority, id): "deep" loads before "shallow", so
    // shallow's /ws/deep/ arrives second and would swallow deep's
    // /ws/deep/inner/.
    await load(only("deep", "shallow"));

    const registry = getWsRouteRegistry();
    expect(registry.resolveScope("/ws/deep/inner/x")).toBe("deep");
    expect(getPluginStatusStore().getStatus("shallow")?.loaded).toBe(false);
    expect(getPluginStatusStore().getStatus("shallow")?.error).toContain("overlaps");
  });
});

// ─── #E2 — reserved core scopes and prefixes ───────────────────────────────
describe("#E2 reserved scopes and prefixes", () => {
  it("throws for all 8 reserved cases and leaves the registry unchanged", async () => {
    await load(only("reserved-cases"));

    const results = g.__e2Results as Array<{ scope: string; prefix: string; threw: boolean }>;
    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(r.threw, `${r.scope} @ ${r.prefix} must throw`).toBe(true);
    }

    const registry = getWsRouteRegistry();
    const store = getPluginStatusStore();
    // The plugin whose registrations were all rejected is marked failed.
    expect(store.getStatus("reserved-cases")?.loaded).toBe(false);
    // And nothing it attempted landed in the registry.
    for (const r of results) {
      expect(registry.get(r.scope)).toBeUndefined();
      expect(registry.resolveScope(`${r.prefix}x`)).toBe(null);
    }
  });

  it("throws for a valid-shape prefix nesting under a reserved core prefix", async () => {
    await load(only("nested-reserved"));

    const errors = g.__nestedReservedErrors as string[];
    expect(errors[0]).toContain("/ws/terminal/x/");
    expect(errors[0]).toContain("reserved core prefix");
    expect(errors[1]).toContain("/ws/bridge/");
    expect(errors[1]).toContain("reserved core prefix");
    expect(getWsRouteRegistry().resolveScope("/ws/terminal/x/y")).toBe(null);
  });
});

// ─── #E3 — late registration + re-activation ───────────────────────────────
describe("#E3 late registration and re-activation", () => {
  it("throws after activation completes; toggle off→on registers afresh", async () => {
    const registry = getWsRouteRegistry();

    // Pass 1 — activation registers.
    await load(only("reactivating"));
    expect(registry.resolveScope("/ws/ext/x")).toBe("ext");

    // Late registration (activation completed) throws.
    const ctx = g.__extCtx as ServerPluginContext;
    expect(() =>
      ctx.registerWsRoute("late-scope", {
        pathPrefix: "/ws/late/",
        admitOrigins: [],
        handleUpgrade: () => {},
      }),
    ).toThrow(/outside activation/);
    expect(registry.resolveScope("/ws/late/x")).toBe(null);

    // Toggle OFF (a loader pass with the plugin disabled) tears the routes
    // down and tombstones the prefix.
    await load(() => false);
    expect(registry.resolveScope("/ws/ext/x")).toBe(null);
    expect(registry.isTombstonedPath("/ws/ext/x")).toBe(true);

    // Toggle ON — second activation registers afresh, and the scope resolves
    // to the NEW activation's handler.
    await load(only("reactivating"));
    expect(g.__activations).toBe(2); // passes 1 and 3 ran the entry (2 was disabled)
    expect(registry.resolveScope("/ws/ext/x")).toBe("ext");
    expect(registry.isTombstonedPath("/ws/ext/x")).toBe(false);
    registry.get("ext")?.handleUpgrade(undefined as never, undefined as never, undefined as never, {
      pluginId: "reactivating",
      scope: "ext",
      trackSocket: () => {},
    });
    expect(g.__handlerGeneration).toBe(2);
  });
});

// ─── Teardown closes tracked sockets with 1001 ─────────────────────────────
describe("teardownPlugin closes sockets (spec: plugin disable tears down)", () => {
  it("closes every tracked socket with code 1001", () => {
    const registry = getWsRouteRegistry();
    const socket = { close: vi.fn(), once: vi.fn() };
    registry.trackSocket("some-plugin", socket as unknown as WsSocketLike);

    registry.teardownPlugin("some-plugin");

    expect(socket.close).toHaveBeenCalledWith(1001, expect.any(String));
    // Idempotent: a second teardown is a no-op, not a second close.
    registry.teardownPlugin("some-plugin");
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
});
