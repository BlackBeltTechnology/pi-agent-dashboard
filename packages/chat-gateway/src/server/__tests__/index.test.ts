/**
 * Plugin entry tests — the inertness contract (task 1.3) and the fail-loud
 * behaviour when the host lacks the in-process frame seam.
 *
 * See change: add-chat-gateway.
 */
import { describe, expect, it, vi } from "vitest";
import registerChatGateway from "../index.js";

function fakeCtx(config: Record<string, unknown>, opts: { frameSeam?: boolean } = {}) {
  const info = vi.fn();
  const error = vi.fn();
  const onShutdown = vi.fn();
  const spawnSession = vi.fn(async () => ({ success: false }));
  const ctx = {
    logger: { info, warn: vi.fn(), error, debug: vi.fn() },
    getPluginConfig: () => config,
    onShutdown,
    spawnSession,
    abortSession: () => false,
    sendExtensionMessage: () => false,
    mintSpawnToken: () => "tok",
    onSessionResolved: () => () => {},
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    subscribeSession: opts.frameSeam === false ? undefined : () => () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { ctx, info, error, onShutdown, spawnSession };
}

describe("chat-gateway plugin entry", () => {
  it("is inert with no token: no adapter, no connection, no shutdown hook", async () => {
    const { ctx, info, onShutdown, spawnSession } = fakeCtx({});

    await registerChatGateway(ctx);

    expect(info).toHaveBeenCalledWith(expect.stringContaining("inert"));
    expect(onShutdown).not.toHaveBeenCalled();
    expect(spawnSession).not.toHaveBeenCalled();
  });

  it("is inert when disabled even with a token", async () => {
    const { ctx, info, onShutdown } = fakeCtx({ token: "t", enabled: false });

    await registerChatGateway(ctx);

    expect(info).toHaveBeenCalledWith(expect.stringContaining("inert"));
    expect(onShutdown).not.toHaveBeenCalled();
  });

  it("fails LOUDLY when the host lacks the frame seam", async () => {
    const { ctx, error, info } = fakeCtx({ token: "t" }, { frameSeam: false });

    await registerChatGateway(ctx);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("subscribeSession"));
    // Never claims to have started.
    expect(info).not.toHaveBeenCalledWith(expect.stringContaining("started"));
  });
});
