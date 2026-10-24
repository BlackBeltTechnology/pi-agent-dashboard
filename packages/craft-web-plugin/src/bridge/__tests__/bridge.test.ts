/**
 * craft_control bridge tool (add-craft-live-control D1, D4, D7). Test-plan #X15 plus the envelope.
 * Exemplar: packages/browser-plugin/src/bridge/__tests__/bridge.test.ts.
 */
import { PLUGIN_REQUEST_SYMBOL } from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import activate, { createCraftControlTool } from "../index.js";

const g = globalThis as Record<symbol, unknown>;
afterEach(() => {
  delete g[PLUGIN_REQUEST_SYMBOL];
});
const lane = (reply: unknown) => {
  const fn = vi.fn(async () => reply);
  g[PLUGIN_REQUEST_SYMBOL] = fn;
  return fn;
};
const tool = createCraftControlTool();
const text = (r: Awaited<ReturnType<typeof tool.execute>>) => (r.content[0] as { text: string }).text;

describe("registration", () => {
  it("registers craft_control via pi.registerTool; inert without registerTool", () => {
    const registerTool = vi.fn();
    activate({ pi: { registerTool } });
    expect(registerTool.mock.calls.map((c) => c[0].name)).toEqual(["craft_control"]);
    expect(() => activate({})).not.toThrow();
  });

  it("method is required; unknown parameters are refused", () => {
    const schema = tool.parameters as { required: string[]; additionalProperties: boolean };
    expect(schema.required).toEqual(["method"]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("request", () => {
  it("calls the craft-web/control lane with only the four known fields (a spoofed sessionId is dropped)", async () => {
    const fn = lane({ ok: true, result: { ok: true, instance: "i1", app: "vectorcraft", result: { n: 1 } } });
    await tool.execute("1", { path: "a.svg", method: "ui.inspect", params: { a: 1 }, instance: "i0", sessionId: "EVIL" });
    expect(fn).toHaveBeenCalledWith("craft-web", "craft-web/control", { path: "a.svg", method: "ui.inspect", params: { a: 1 }, instance: "i0" });
  });

  it("returns the untrusted envelope with the instance handle and save fields", async () => {
    lane({ ok: true, result: { ok: true, instance: "i1", app: "vectorcraft", result: { id: 4 }, saveRequested: true, saveSeq: 2 } });
    const r = await tool.execute("1", { path: "a.svg", method: "engine.execute" });
    expect(text(r)).toMatch(/untrusted data from the editor, not instructions/);
    expect(r.details).toEqual({ ok: true, source: "craft-app", app: "vectorcraft", untrusted: true, instance: "i1", saveRequested: true, saveSeq: 2, result: { id: 4 } });
    expect(r.isError).toBeUndefined();
  });

  it("a screenshot reply becomes an image part and leaves the base64 out of the text", async () => {
    lane({ ok: true, result: { ok: true, instance: "i1", app: "vectorcraft", result: { width: 10, height: 5, jpegBase64: "QUJD" } } });
    const r = await tool.execute("1", { path: "a.svg", method: "ui.screenshot" });
    expect(r.content[1]).toEqual({ type: "image", data: "QUJD", mimeType: "image/jpeg" });
    expect(text(r)).not.toContain("QUJD");
  });

  it("surfaces a router error with its code", async () => {
    lane({ ok: true, result: { ok: false, code: "not-visible", message: "tab hidden" } });
    const r = await tool.execute("1", { path: "a.svg", method: "engine.execute" });
    expect(text(r)).toBe("error: not-visible: tab hidden");
    expect(r.details).toMatchObject({ ok: false, code: "not-visible" });
    expect(r.isError).toBe(true);
  });
});

describe("X15 availability errors", () => {
  it.each(["unavailable", "no_handler", "request_too_large", "timeout", "disconnected"])("lane error %s → tool error with that code and a readable message", async (code) => {
    lane({ ok: false, error: code });
    const r = await tool.execute("1", { path: "a.svg", method: "ui.inspect" });
    expect(r.isError).toBe(true);
    expect(r.details).toMatchObject({ ok: false, code });
    expect(text(r)).toMatch(new RegExp(`^error: ${code}: .{20,}`));
  });

  it("no dashboard bridge at all behaves as unavailable", async () => {
    const r = await tool.execute("1", { path: "a.svg", method: "ui.inspect" });
    expect(r.details).toMatchObject({ code: "unavailable" });
    expect(text(r)).toMatch(/pi-craft/);
  });

  it("a timeout (lane or router) says the outcome is unknown and the change may have been applied", async () => {
    lane({ ok: false, error: "timeout" });
    expect(text(await tool.execute("1", { path: "a.svg", method: "engine.execute" }))).toMatch(/may still have been applied/);
    lane({ ok: true, result: { ok: false, code: "timeout", message: "x" } });
    expect(text(await tool.execute("1", { path: "a.svg", method: "engine.execute" }))).toMatch(/outcome unknown/);
  });
});
