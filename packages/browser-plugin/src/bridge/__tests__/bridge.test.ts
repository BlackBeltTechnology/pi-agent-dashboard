/** Bridge tools (task 5.1, 5.3; #X13). See change: add-browser-editor-pane-tab. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_REQUEST_SYMBOL } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import activate, { createBrowserTools, type ToolContext } from "../index.js";

const g = globalThis as Record<symbol, unknown>;
afterEach(() => {
  delete g[PLUGIN_REQUEST_SYMBOL];
});

const lane = (reply: unknown) => {
  const fn = vi.fn(async () => reply);
  g[PLUGIN_REQUEST_SYMBOL] = fn;
  return fn;
};
const tool = (name: string) => createBrowserTools().find((t) => t.name === name)!;
const ctxWith = (confirm: (...a: unknown[]) => Promise<boolean>): ToolContext => ({ hasUI: true, ui: { confirm: confirm as never } });

describe("registration (5.1)", () => {
  it("registers both tools via pi.registerTool", () => {
    const registerTool = vi.fn();
    activate({ pi: { registerTool } });
    expect(registerTool.mock.calls.map((c) => c[0].name).sort()).toEqual(["browser_await_human", "browser_show_in_pane"]);
  });
  it("is inert without registerTool", () => {
    expect(() => activate({})).not.toThrow();
  });
  it("both call requestPluginServer(browser, browser/open) and drop spoofed fields", async () => {
    const fn = lane({ ok: true, result: { path: "browser:i:1" } });
    const res = await tool("browser_show_in_pane").execute("1", { instanceId: "i", tabId: 1, sessionId: "T" });
    expect(fn).toHaveBeenCalledWith("browser", "browser/open", { kind: "show", instanceId: "i", tabId: 1 });
    expect(res.content[0].text).toContain("browser:i:1");
  });
  it("surfaces a lane/server error as an error result", async () => {
    lane({ ok: false, error: "rate-limited" });
    const res = await tool("browser_show_in_pane").execute("1", { instanceId: "i" });
    expect(res.content[0].text).toBe("error: rate-limited");
    expect(res.details.ok).toBe(false);
    delete g[PLUGIN_REQUEST_SYMBOL];
    expect((await tool("browser_show_in_pane").execute("1", { instanceId: "i" })).content[0].text).toBe("error: unavailable");
  });
});

describe("browser_await_human (#X13)", () => {
  const params = { instanceId: "inst-1", reason: "Sign in to GitHub" };

  it("confirm → done; the prompt carries namespaced plugin metadata and the reason; open is a takeover", async () => {
    const fn = lane({ ok: true, result: {} });
    const confirm = vi.fn(async () => true);
    const res = await tool("browser_await_human").execute("1", params, undefined, undefined, ctxWith(confirm));
    expect(res.details.outcome).toBe("done");
    expect(fn).toHaveBeenCalledWith("browser", "browser/open", { kind: "takeover", instanceId: "inst-1" });
    expect(confirm).toHaveBeenCalledWith("Browser: your turn", "Sign in to GitHub", {
      pluginMeta: { pluginId: "browser", kind: "browser-takeover", instanceId: "inst-1" },
    });
    // the open happens BEFORE the prompt blocks
    expect(fn.mock.invocationCallOrder[0]).toBeLessThan(confirm.mock.invocationCallOrder[0]);
  });

  it.each([
    ["declined", async () => false],
    ["timed out / dismissed (throws)", async () => { throw new Error("timeout"); }],
  ])("%s → cancelled", async (_n, impl) => {
    lane({ ok: true, result: {} });
    const res = await tool("browser_await_human").execute("1", params, undefined, undefined, ctxWith(impl));
    expect(res.details.outcome).toBe("cancelled");
  });

  it("no UI → cancelled/no-ui, no prompt and nothing opened", async () => {
    const fn = lane({ ok: true, result: {} });
    for (const ctx of [undefined, { hasUI: false }, { hasUI: true }] as Array<ToolContext | undefined>) {
      const res = await tool("browser_await_human").execute("1", params, undefined, undefined, ctx);
      expect(res.details).toEqual({ outcome: "cancelled", reason: "no-ui" });
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("an open refusal cancels without raising a prompt", async () => {
    lane({ ok: false, error: "disabled" });
    const confirm = vi.fn(async () => true);
    const res = await tool("browser_await_human").execute("1", params, undefined, undefined, ctxWith(confirm));
    expect(res.details).toEqual({ outcome: "cancelled", reason: "disabled" });
    expect(confirm).not.toHaveBeenCalled();
  });
});
