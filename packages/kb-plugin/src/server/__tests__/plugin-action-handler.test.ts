/**
 * kb-plugin plugin_action handler — reindex + config mutations reach the SAME
 * cores the REST routes call, guarded by the same cwd allow-list. The cores are
 * mocked so this asserts the WIRING (routing + guard), not the disk walk.
 * See change: fix-plugin-action-fanout-and-handlers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above module-level const initializers, so the mock fns must
// live in vi.hoisted to avoid a TDZ hit inside the factory.
const { reindexAll, applyConfigPatchAndTrust, isAllowedCwd } = vi.hoisted(() => ({
  reindexAll: vi.fn(async () => ({ changed: 1, chunks: 2 })),
  applyConfigPatchAndTrust: vi.fn((): { ok: true; projectPath: string; untrustedRefs: string[] } => ({
    ok: true,
    projectPath: "/w/repo/.pi/dashboard/knowledge_base.json",
    untrustedRefs: [],
  })),
  isAllowedCwd: vi.fn(() => true),
}));

vi.mock("../kb-routes.js", () => ({
  mountKbRoutes: vi.fn(),
  reindexAll,
  applyConfigPatchAndTrust,
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
    applyConfigPatchAndTrust.mockClear();
    isAllowedCwd.mockReturnValue(true);
  });

  it("reindex reaches the reindexAll core for an allowed cwd", async () => {
    const { handler } = await setup();
    handler({ pluginId: "kb", action: "reindex", payload: { cwd: "/w/repo" } });
    await tick();
    expect(reindexAll).toHaveBeenCalledWith("/w/repo", expect.anything());
  });

  it("config.set reaches the applyConfigPatchAndTrust core", async () => {
    const { handler } = await setup();
    handler({ pluginId: "kb", action: "config.set", payload: { cwd: "/w/repo", patch: { include: ["docs"] } } });
    expect(applyConfigPatchAndTrust).toHaveBeenCalledWith("/w/repo", { include: ["docs"] });
  });

  it("E28 config.set with trustRefs passes them through and warns on untrustedRefs", async () => {
    applyConfigPatchAndTrust.mockReturnValueOnce({ ok: true, projectPath: "/p", untrustedRefs: ["missing"] });
    const { handler, ctx } = await setup();
    handler({ pluginId: "kb", action: "config.set", payload: { cwd: "/w/repo", patch: { trustRefs: ["g", "missing"] } } });
    expect(applyConfigPatchAndTrust).toHaveBeenCalledWith("/w/repo", { trustRefs: ["g", "missing"] });
    const warns = (ctx.logger.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(warns.some((w) => w.includes("missing"))).toBe(true);
  });

  it("X8 config.set with trustRefs for a non-admitted cwd is guarded — no core call", async () => {
    isAllowedCwd.mockReturnValue(false);
    const { handler, ctx } = await setup();
    handler({ pluginId: "kb", action: "config.set", payload: { cwd: "/etc", patch: { trustRefs: ["g"] } } });
    expect(applyConfigPatchAndTrust).not.toHaveBeenCalled();
    expect(ctx.logger.warn as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it("rejects a cwd outside the allow-list — no core call", async () => {
    isAllowedCwd.mockReturnValue(false);
    const { handler, ctx } = await setup();
    const result = handler({ pluginId: "kb", action: "reindex", payload: { cwd: "/etc" } });
    await tick();
    expect(reindexAll).not.toHaveBeenCalled();
    // Task 3.3 (design D18): this denial site is NOT an HTTP route — it has no
    // response body to enrich, so it gains no `reason`/`hint` and its behavior
    // is byte-identical (same warn line, void return, no crash).
    expect(result).toBeUndefined();
    expect(ctx.logger.warn as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      "kb reindex: cwd not allowed (/etc)",
    );
  });

  it("ignores a mismatched pluginId (defense-in-depth)", async () => {
    const { handler } = await setup();
    handler({ pluginId: "goal", action: "reindex", payload: { cwd: "/w/repo" } });
    await tick();
    expect(reindexAll).not.toHaveBeenCalled();
  });
});
