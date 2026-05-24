/**
 * Tests for defensive route registration in the flows-anthropic-bridge
 * server entry. The route is diagnostic-only; the plugin's core value
 * (bridge event listeners) must keep working even when Fastify is in an
 * unexpected state.
 */
import { describe, expect, it, vi } from "vitest";
import registerPlugin from "../server/index.js";

interface FakeFastify {
  server: { listening: boolean };
  get: ReturnType<typeof vi.fn>;
}

function makeCtx(opts: {
  listening: boolean;
  getThrows?: Error;
}): {
  ctx: any;
  fastify: FakeFastify;
  warnings: string[];
} {
  const warnings: string[] = [];
  const fastify: FakeFastify = {
    server: { listening: opts.listening },
    get: vi.fn(() => {
      if (opts.getThrows) throw opts.getThrows;
    }),
  };
  const ctx = {
    fastify,
    logger: {
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
      error: () => {},
    },
    // No events surface — registerPlugin gates on `typeof events.on === "function"`.
  };
  return { ctx, fastify, warnings };
}

describe("flows-anthropic-bridge server entry — defensive route registration", () => {
  it("registers the /api/flows-anthropic-bridge/status route when fastify is not yet listening", async () => {
    const { ctx, fastify, warnings } = makeCtx({ listening: false });

    await registerPlugin(ctx as any);

    expect(fastify.get).toHaveBeenCalledTimes(1);
    expect(fastify.get).toHaveBeenCalledWith(
      "/api/flows-anthropic-bridge/status",
      expect.any(Function),
    );
    expect(warnings).toHaveLength(0);
  });

  it("skips route registration and logs a warning when fastify is already listening", async () => {
    const { ctx, fastify, warnings } = makeCtx({ listening: true });

    await registerPlugin(ctx as any);

    expect(fastify.get).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/already listening/i);
    expect(warnings[0]).toMatch(/Bridge event listeners still active/);
  });

  it("catches unexpected route-registration errors and warns instead of throwing", async () => {
    const boom = new Error("FST_ERR_INSTANCE_ALREADY_LISTENING: simulated");
    const { ctx, warnings } = makeCtx({ listening: false, getThrows: boom });

    // Must not throw — plugin's bridge listeners still need to run.
    await expect(registerPlugin(ctx as any)).resolves.toBeUndefined();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/route registration failed/);
    expect(warnings[0]).toMatch(/FST_ERR_INSTANCE_ALREADY_LISTENING/);
  });

  it("still completes plugin initialization when fastify.server is missing entirely", async () => {
    // Some test/embed contexts don't expose `.server`; the guard must
    // tolerate undefined and fall through to the try/catch path.
    const warnings: string[] = [];
    const fastify = {
      // no `server` field
      get: vi.fn(),
    };
    const ctx = {
      fastify,
      logger: {
        info: () => {},
        warn: (msg: string) => warnings.push(msg),
        error: () => {},
      },
    };

    await registerPlugin(ctx as any);

    expect(fastify.get).toHaveBeenCalledTimes(1);
    expect(warnings).toHaveLength(0);
  });
});
