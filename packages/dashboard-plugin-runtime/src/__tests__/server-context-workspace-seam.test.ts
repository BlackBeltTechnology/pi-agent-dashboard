/**
 * Workspace seam on ServerPluginContext (change: add-chat-gateway-team-controls,
 * spec plugin-workspace-seam).
 *
 * The context exposes a total `listWorkspaces()` accessor and an
 * `onWorkspacesChanged()` subscription; both delegate to the injected deps and
 * default safely when a host does not wire them. Additive: existing members are
 * unchanged. Scenarios: 10f.7 (additivity), seam delegation / unsubscribe.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createServerPluginContext,
  type ServerContextDeps,
} from "../server/server-context.js";

function baseDeps(extra: Partial<ServerContextDeps> = {}): ServerContextDeps {
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
    spawnSession: async () => ({ success: true }),
    abortSession: () => true,
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
    ...extra,
  };
}

describe("ServerPluginContext workspace seam", () => {
  it("defaults to an empty, total accessor when the host does not wire it", () => {
    const ctx = createServerPluginContext(baseDeps(), "test-plugin");
    expect(ctx.listWorkspaces()).toEqual([]);
    expect(typeof ctx.onWorkspacesChanged).toBe("function");
    // A default subscription is inert but returns a callable unsubscribe.
    expect(() => ctx.onWorkspacesChanged(() => {})()).not.toThrow();
  });

  it("delegates reads and subscriptions to the injected seam", () => {
    const unsub = vi.fn();
    const handlerRef: { current: (() => void) | null } = { current: null };
    const deps = baseDeps({
      listWorkspaces: () => [{ id: "ws_1", name: "Team", folders: ["/a"] }],
      onWorkspacesChanged: (handler) => {
        handlerRef.current = handler;
        return unsub;
      },
    });
    const ctx = createServerPluginContext(deps, "test-plugin");

    expect(ctx.listWorkspaces()).toEqual([{ id: "ws_1", name: "Team", folders: ["/a"] }]);

    let called = 0;
    const off = ctx.onWorkspacesChanged(() => {
      called += 1;
    });
    handlerRef.current?.();
    expect(called).toBe(1);
    expect(off).toBe(unsub);
  });

  it("10f.7: leaves an existing context member unchanged (additivity)", () => {
    const ctx = createServerPluginContext(baseDeps({ getPluginConfig: () => ({ keep: true }) }), "p");
    expect(ctx.getPluginConfig()).toEqual({ keep: true });
  });
});
