/**
 * kb-plugin plugin_action handler — reindex + config mutations reach the SAME
 * cores the REST routes call, guarded by the same cwd allow-list. The cores are
 * mocked so this asserts the WIRING (routing + guard), not the disk walk.
 * See change: fix-plugin-action-fanout-and-handlers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above module-level const initializers, so the mock fns must
// live in vi.hoisted to avoid a TDZ hit inside the factory.
const { reindexAll, applyConfigPatch, isAllowedCwd } = vi.hoisted(() => ({
  reindexAll: vi.fn(async () => ({ changed: 1, chunks: 2 })),
  applyConfigPatch: vi.fn(() => ({ ok: true as const, projectPath: "/w/repo/.pi/dashboard/knowledge_base.json" })),
  isAllowedCwd: vi.fn(() => true),
}));

vi.mock("../kb-routes.js", () => ({
  mountKbRoutes: vi.fn(),
  reindexAll,
  applyConfigPatch,
  isAllowedCwd,
}));
vi.mock("@blackbelt-technology/pi-dashboard-kb", () => ({
  loadConfig: () => ({ origin: "project" }),
}));

type Handler = (msg: unknown) => void;

async function setup() {
  const { registerPlugin } = await import("../index.js");
  let handler: Handler | undefined;
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    consume: vi.fn(() => () => ["/w/repo"]),
    sessionManager: { listAll: () => [] },
    fastify: {},
    registerBrowserHandler: (type: string, h: Handler) => {
      if (type === "plugin_action") handler = h;
    },
  } as unknown as Parameters<typeof registerPlugin>[0];
  await registerPlugin(ctx);
  if (!handler) throw new Error("plugin_action handler not registered");
  return { handler, ctx };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("kb plugin_action handler", () => {
  beforeEach(() => {
    reindexAll.mockClear();
    applyConfigPatch.mockClear();
    isAllowedCwd.mockReturnValue(true);
  });

  it("reindex reaches the reindexAll core for an allowed cwd", async () => {
    const { handler } = await setup();
    handler({ pluginId: "kb", action: "reindex", payload: { cwd: "/w/repo" } });
    await tick();
    expect(reindexAll).toHaveBeenCalledWith("/w/repo");
  });

  it("config.set reaches the applyConfigPatch core", async () => {
    const { handler } = await setup();
    handler({ pluginId: "kb", action: "config.set", payload: { cwd: "/w/repo", patch: { include: ["docs"] } } });
    expect(applyConfigPatch).toHaveBeenCalledWith("/w/repo", { include: ["docs"] });
  });

  it("rejects a cwd outside the allow-list — no core call", async () => {
    isAllowedCwd.mockReturnValue(false);
    const { handler, ctx } = await setup();
    handler({ pluginId: "kb", action: "reindex", payload: { cwd: "/etc" } });
    await tick();
    expect(reindexAll).not.toHaveBeenCalled();
    expect((ctx.logger.warn as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it("ignores a mismatched pluginId (defense-in-depth)", async () => {
    const { handler } = await setup();
    handler({ pluginId: "goal", action: "reindex", payload: { cwd: "/w/repo" } });
    await tick();
    expect(reindexAll).not.toHaveBeenCalled();
  });
});
