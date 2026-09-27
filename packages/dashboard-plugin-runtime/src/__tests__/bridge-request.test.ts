/**
 * X11 — the plugin-side request helper resolves `unavailable` immediately when
 * no dashboard bridge installed the global symbol, and otherwise delegates.
 * See change: expose-plugin-credential-and-oauth-seams (D7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_REQUEST_SYMBOL, requestPluginServer } from "../bridge/index.js";

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[PLUGIN_REQUEST_SYMBOL];
});

describe("requestPluginServer", () => {
  it("X11: resolves unavailable when the symbol is absent", async () => {
    await expect(requestPluginServer("p", "t", {})).resolves.toEqual({ ok: false, error: "unavailable" });
  });

  it("delegates to the installed bridge function", async () => {
    const fn = vi.fn(async () => ({ ok: true as const, result: "echo: hi" }));
    (globalThis as Record<symbol, unknown>)[PLUGIN_REQUEST_SYMBOL] = fn;
    await expect(requestPluginServer("demo", "demo/echo", { text: "hi" })).resolves.toEqual({ ok: true, result: "echo: hi" });
    expect(fn).toHaveBeenCalledWith("demo", "demo/echo", { text: "hi" });
  });

  it("uses the same global symbol key as the core bridge", () => {
    expect(PLUGIN_REQUEST_SYMBOL).toBe(Symbol.for("pi-dashboard.pluginRequest"));
  });
});
