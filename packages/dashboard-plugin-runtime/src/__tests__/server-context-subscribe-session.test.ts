/**
 * `subscribeSession` seam on ServerPluginContext — the in-process
 * headless-client lane added for chat-gateway.
 *
 * The seam is OPTIONAL (the `modelRuntime` / `isPiExtensionInstalled`
 * convention): a host that does not wire it must leave the field absent so the
 * plugin owns the degradation, rather than exposing an inert-but-present hook
 * the plugin cannot detect.
 *
 * See change: add-chat-gateway.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createServerPluginContext,
  type ServerContextDeps,
} from "../server/server-context.js";

function baseDeps(): ServerContextDeps {
  const noop = () => {};
  return {
    fastify: {} as ServerContextDeps["fastify"],
    sessionManager: {} as ServerContextDeps["sessionManager"],
    eventStore: {} as ServerContextDeps["eventStore"],
    broadcastToSubscribers: noop,
    registerPiHandler: noop,
    registerBrowserHandler: noop,
    onEvent: () => noop,
    onSessionEnded: () => noop,
    onSessionResolved: () => noop,
    sendToSession: () => false,
    emitEventToSession: () => false,
    sendExtensionMessage: () => false,
    spawnSession: async () => ({ success: false }),
    abortSession: () => false,
    abortSpawnedRun: async () => false,
    registerCwdPolicy: noop,
    unregisterCwdPolicy: noop,
    provide: noop,
    consume: () => undefined,
    consumeAll: () => [],
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
    mintSpawnToken: () => "tok",
    renameSession: () => false,
    assignSessionRef: () => false,
    networkGuard: (async () => {}) as ServerContextDeps["networkGuard"],
    onShutdown: () => () => {},
  };
}

describe("ServerPluginContext.subscribeSession", () => {
  it("forwards the host seam verbatim", () => {
    const off = vi.fn();
    const seam = vi.fn(() => off);
    const ctx = createServerPluginContext({ ...baseDeps(), subscribeSession: seam }, "chat-gateway");

    const handler = vi.fn();
    const returned = ctx.subscribeSession?.("s1", handler);

    expect(seam).toHaveBeenCalledWith("s1", handler);
    expect(returned).toBe(off);
  });

  it("is absent when the host does not wire it (plugin owns the degradation)", () => {
    const ctx = createServerPluginContext(baseDeps(), "chat-gateway");
    expect(ctx.subscribeSession).toBeUndefined();
  });
});
