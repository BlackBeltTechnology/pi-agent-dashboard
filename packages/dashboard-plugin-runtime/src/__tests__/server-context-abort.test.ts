/**
 * createServerPluginContext exposes the host-supplied `abortSession` hook
 * verbatim. The trust gate lives in the host (server.ts) that builds the deps,
 * mirroring `spawnSession`; here we assert the context forwards both a
 * trusted (returns true) and an untrusted (returns false) hook unchanged.
 *
 * See change: automation-ui-mockup-parity.
 */
import { describe, it, expect, vi } from "vitest";
import { createServerPluginContext, type ServerContextDeps } from "../server/server-context.js";

function deps(abortSession: ServerContextDeps["abortSession"]): ServerContextDeps {
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
    abortSession,
    abortAutomationRun: async () => false,
    provide: () => {},
    consume: () => undefined,
    getPluginConfig: () => ({}),
    updatePluginConfig: async () => {},
  };
}

describe("createServerPluginContext abortSession", () => {
  it("exposes a trusted abortSession hook that dispatches and returns true", () => {
    const hook = vi.fn(() => true);
    const ctx = createServerPluginContext(deps(hook), "automation");
    expect(ctx.abortSession("sess-1")).toBe(true);
    expect(hook).toHaveBeenCalledWith("sess-1");
  });

  it("forwards an untrusted no-op hook that returns false", () => {
    const ctx = createServerPluginContext(deps(() => false), "untrusted");
    expect(ctx.abortSession("sess-1")).toBe(false);
  });
});

describe("createServerPluginContext abortAutomationRun", () => {
  it("forwards the host-supplied termination hook verbatim", async () => {
    const hook = vi.fn(async () => true);
    const d = deps(() => true);
    d.abortAutomationRun = hook;
    const ctx = createServerPluginContext(d, "automation");
    await expect(ctx.abortAutomationRun({ sessionId: "s1", spawnToken: "tok", graceful: true })).resolves.toBe(true);
    expect(hook).toHaveBeenCalledWith({ sessionId: "s1", spawnToken: "tok", graceful: true });
  });
});
