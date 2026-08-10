/**
 * Tests for the plugin-config write path: the `send` interception routing and
 * the `writePluginConfig` REST helper. See change: fix-plugin-config-write-persistence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchPluginMessage, writePluginConfig } from "../package/plugins-api.js";

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

describe("dispatchPluginMessage (send interception)", () => {
  it("routes plugin_config_write to the REST helper, not the WS transport", () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const wsSend = vi.fn();

    const ret = dispatchPluginMessage(
      { type: "plugin_config_write", id: "flows", config: { editFlow: true } },
      wsSend,
    );

    expect(wsSend).not.toHaveBeenCalled();
    expect(ret).toBeInstanceOf(Promise);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/config/plugins/flows");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ editFlow: true });
  });

  it("passes non-config messages through to the WS transport", () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const wsSend = vi.fn();

    dispatchPluginMessage({ type: "flow_control", sessionId: "s1", action: "abort" }, wsSend);

    expect(wsSend).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a config write with no id as a pass-through (defensive)", () => {
    const wsSend = vi.fn();
    dispatchPluginMessage({ type: "plugin_config_write", config: {} }, wsSend);
    expect(wsSend).toHaveBeenCalledTimes(1);
  });
});

describe("writePluginConfig", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("resolves on 2xx", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, config: { editFlow: true } }), { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(writePluginConfig("flows", { editFlow: true })).resolves.toBeUndefined();
  });

  it("rejects with the route error on 400 (schema-invalid)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: "bad value" }), { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(writePluginConfig("flows", { editFlow: 7 as unknown as boolean })).rejects.toThrow(/bad value/);
  });

  it("rejects on 409 (disabled plugin)", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: "disabled" }), { status: 409 }),
    ) as unknown as typeof fetch;
    await expect(writePluginConfig("goal", { x: 1 })).rejects.toThrow(/disabled/);
  });
});
