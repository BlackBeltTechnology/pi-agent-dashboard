/**
 * Task 3.3 (design D18 / test-plan #X11) — non-HTTP denial sites stay untouched.
 *
 * A `plugin_action` browser-message handler has NO HTTP response body to enrich,
 * so it gains no `reason`/`hint`. This module does not perform a cwd allow-list
 * refusal at all today (the old `set-disabled` cwd guard moved out with the
 * mcp-client extraction), which is exactly the invariant: an unknown `cwd` in
 * the payload changes nothing, and no remedy fields are emitted.
 * See change: add-access-grants-and-review.
 */
import { describe, expect, it, vi } from "vitest";

const { runInstaller, createInstallerEnv } = vi.hoisted(() => ({
  runInstaller: vi.fn(() => ({
    state: "INSTALL_FAILED",
    exitCode: 1,
    message: "iMCP absent",
    appPresent: false,
  })),
  createInstallerEnv: vi.fn(() => ({})),
}));

vi.mock("../install.js", () => ({ runInstaller }));
vi.mock("../env.js", () => ({ createInstallerEnv, BREW_TIMEOUT_MS: 1 }));

type Handler = (msg: unknown) => unknown;

async function setup(): Promise<{ handler: Handler; ctx: any }> {
  const { registerPlugin } = await import("../server/index.js");
  let handler: Handler | undefined;
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    consume: vi.fn(() => ({ readServerEntry: () => undefined })),
    getPluginConfig: vi.fn(() => ({})),
    fastify: { get: vi.fn() },
    registerBrowserHandler: (type: string, h: Handler) => {
      if (type === "plugin_action") handler = h;
    },
  };
  await registerPlugin(ctx as any);
  if (!handler) throw new Error("plugin_action handler not registered");
  return { handler, ctx };
}

describe("apple-tools plugin_action handler — no cwd denial (task 3.3)", () => {
  it("does not deny or annotate an unknown cwd (behavior unchanged)", async () => {
    const { handler, ctx } = await setup();
    const result = handler({ pluginId: "apple-tools", action: "run-installer", payload: { cwd: "/etc" } });
    expect(result).toBeUndefined();
    expect(ctx.logger.warn).toHaveBeenCalled();
    // No remedy fields anywhere — a non-HTTP handler has no body to enrich.
    for (const call of (ctx.logger.warn as any).mock.calls) {
      expect(String(call[0])).not.toMatch(/reason|hint|cwd not allowed/i);
    }
  });

  it("ignores a payload with no cwd at all (no cwd gate exists)", async () => {
    const { handler } = await setup();
    expect(handler({ pluginId: "apple-tools", action: "run-installer", payload: {} })).toBeUndefined();
  });
});
