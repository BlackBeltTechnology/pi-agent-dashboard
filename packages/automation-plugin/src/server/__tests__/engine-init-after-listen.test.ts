/**
 * Engine init is deferred (ENGINE_INIT_DELAY_MS) so it runs AFTER the host
 * Fastify instance is listening — where `fastify.addHook` throws. The init must
 * still complete: the run-delivery `onEvent` handler and the roles "used by"
 * registration must not be lost to that throw (otherwise run sessions spawn,
 * never receive their prompt, and stay `running` forever).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("automation engine init after server listen", () => {
  it("registers onEvent + roles usage even when addHook throws (already listening)", async () => {
    vi.useFakeTimers();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const registerUsage = vi.fn(() => () => {});
    const fastify = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      addHook: vi.fn(() => {
        throw new Error('Fastify instance is already listening. Cannot call "addHook"!');
      }),
    };
    const onEvent = vi.fn();
    const ctx = {
      logger,
      provide: vi.fn(),
      consume: vi.fn((key: string) => (key === "roles.bindings" ? { registerUsage } : undefined)),
      consumeAll: vi.fn(() => []),
      getPluginConfig: vi.fn(() => ({ scanGlobalScope: false, scanFolderScope: false })),
      sessionManager: { listAll: () => [], getSession: () => undefined },
      fastify,
      spawnSession: vi.fn(),
      abortSpawnedRun: vi.fn(),
      emitEventToSession: vi.fn(),
      sendToSession: vi.fn(),
      onEvent,
      onSessionEnded: vi.fn(),
      onShutdown: vi.fn(),
      registerBrowserHandler: vi.fn(),
    } as unknown as Parameters<typeof registerPlugin>[0];

    await registerPlugin(ctx);
    await vi.advanceTimersByTimeAsync(1500);
    vi.useRealTimers();
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalled(), { timeout: 5000 });

    const errors = logger.error.mock.calls.map((c) => String(c[0]));
    expect(errors.filter((e) => e.includes("engine init failed"))).toEqual([]);
    expect(registerUsage).toHaveBeenCalledWith("automation", expect.any(Function));
  });
});
