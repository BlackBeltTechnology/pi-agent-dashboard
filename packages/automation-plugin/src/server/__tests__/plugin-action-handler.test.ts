/**
 * automation-plugin plugin_action handler — run/stop dispatch to the SAME
 * engine cores the REST routes call. The engine is not yet inited in a unit
 * test (engineRef null), so a `run` reaches the core and gets back a structured
 * "engine not ready" result (logged) — proving the wiring, not the engine.
 * See change: fix-plugin-action-fanout-and-handlers.
 */
import { describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../index.js";

type Handler = (msg: unknown) => void;

async function setup() {
  let handler: Handler | undefined;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fastify = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const ctx = {
    logger,
    provide: vi.fn(),
    consume: vi.fn(),
    consumeAll: vi.fn(() => []),
    getPluginConfig: vi.fn(() => ({})),
    sessionManager: { listAll: () => [], getSession: () => undefined },
    fastify,
    spawnSession: vi.fn(),
    abortSpawnedRun: vi.fn(),
    emitEventToSession: vi.fn(),
    sendToSession: vi.fn(),
    onEvent: vi.fn(),
    onSessionEnded: vi.fn(),
    registerBrowserHandler: (type: string, h: Handler) => {
      if (type === "plugin_action") handler = h;
    },
  } as unknown as Parameters<typeof registerPlugin>[0];
  await registerPlugin(ctx);
  if (!handler) throw new Error("plugin_action handler not registered");
  return { handler, logger };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("automation plugin_action handler", () => {
  it("run reaches the engine core and reports a structured result", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "automation", action: "run", payload: { scope: "folder", cwd: "/w/repo", name: "nightly" } });
    await tick();
    const logged = logger.info.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes('automation run "nightly"'))).toBe(true);
  });

  it("run without a name is a guarded warning, not a throw", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "automation", action: "run", payload: { scope: "folder" } });
    await tick();
    expect(logger.warn).toHaveBeenCalledWith("automation run: name required");
  });

  it("stop without a runId is a guarded warning", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "automation", action: "stop", payload: {} });
    await tick();
    expect(logger.warn).toHaveBeenCalledWith("automation stop: runId required");
  });

  it("ignores a mismatched pluginId (defense-in-depth)", async () => {
    const { handler, logger } = await setup();
    handler({ pluginId: "goal", action: "run", payload: { name: "x" } });
    await tick();
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining("automation run"));
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
