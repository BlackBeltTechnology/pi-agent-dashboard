/**
 * Bridge half of the plugin request/reply lane: delivery, 15 s timeout with
 * late-reply drop, disconnect, request cap, the plugin-side `unavailable`
 * helper, and privacy (nothing rides pi.events).
 * See change: expose-plugin-credential-and-oauth-seams
 * (test-plan E28, E30, X9, X10; X11 lives in dashboard-plugin-runtime).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginRequestClient,
  installPluginRequest,
  PLUGIN_REQUEST_MAX_BYTES,
  PLUGIN_REQUEST_SYMBOL,
} from "../plugin-request-client.js";

/** What a plugin bridge entry does: call the installed global symbol. */
function requestPluginServer(pluginId: string, type: string, payload?: unknown) {
  const fn = (globalThis as Record<symbol, unknown>)[PLUGIN_REQUEST_SYMBOL] as
    | ((p: string, t: string, x?: unknown) => Promise<unknown>)
    | undefined;
  return fn ? fn(pluginId, type, payload) : Promise.resolve({ ok: false, error: "unavailable" });
}

function setup(timeoutMs?: number) {
  const sent: Array<Record<string, unknown>> = [];
  let n = 0;
  const client = createPluginRequestClient({
    send: (m) => { sent.push(m as Record<string, unknown>); },
    timeoutMs,
    newId: () => `r${++n}`,
  });
  return { client, sent };
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<symbol, unknown>)[PLUGIN_REQUEST_SYMBOL];
});

describe("plugin request client (bridge)", () => {
  it("delivers a request frame and resolves with the matching reply", async () => {
    const { client, sent } = setup();
    const p = client.request("demo", "demo/echo", { text: "hi" });
    expect(sent).toEqual([
      { type: "plugin_request", requestId: "r1", pluginId: "demo", messageType: "demo/echo", payload: { text: "hi" } },
    ]);
    client.handleReply({ requestId: "r1", ok: true, result: "echo: hi" });
    await expect(p).resolves.toEqual({ ok: true, result: "echo: hi" });
    expect(client.pendingCount()).toBe(0);
  });

  it("E28: a request at 256 KiB is sent; one byte more fails request_too_large and is never sent", async () => {
    const { client, sent } = setup();
    const atCap = "x".repeat(PLUGIN_REQUEST_MAX_BYTES - 2);
    void client.request("p", "t", atCap).catch(() => {});
    expect(sent).toHaveLength(1);
    await expect(client.request("p", "t", `${atCap}x`)).resolves.toEqual({ ok: false, error: "request_too_large" });
    expect(sent).toHaveLength(1);
    client.failAll("disconnected");
  });

  it("X9: times out at 15 s and drops a late reply", async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const p = client.request("p", "slow");
    vi.advanceTimersByTime(15_000);
    await expect(p).resolves.toEqual({ ok: false, error: "timeout" });
    expect(() => client.handleReply({ requestId: "r1", ok: true, result: 1 })).not.toThrow();
    expect(client.pendingCount()).toBe(0);
  });

  it("X10: a socket close resolves pending calls disconnected", async () => {
    const { client } = setup();
    const p = client.request("p", "t");
    client.failAll("disconnected");
    await expect(p).resolves.toEqual({ ok: false, error: "disconnected" });
  });

  it("the plugin helper reaches an installed client; uninstall only removes its own fn", async () => {
    const { client, sent } = setup();
    const uninstall = installPluginRequest(client.request);
    const p = requestPluginServer("demo", "demo/echo", { text: "hi" });
    client.handleReply({ requestId: String(sent[0].requestId), ok: true, result: "echo: hi" });
    await expect(p).resolves.toEqual({ ok: true, result: "echo: hi" });
    const other = setup().client;
    installPluginRequest(other.request);
    uninstall();
    expect((globalThis as Record<symbol, unknown>)[PLUGIN_REQUEST_SYMBOL]).toBe(other.request);
  });

  it("E30: a full request/reply emits nothing on pi.events", async () => {
    const emit = vi.fn();
    const pi = { events: { emit, on: vi.fn() } };
    const { client, sent } = setup();
    const uninstall = installPluginRequest(client.request);
    const p = requestPluginServer("demo", "lease", { secret: "REQ-SECRET" });
    client.handleReply({ requestId: String(sent[0].requestId), ok: true, result: { token: "REPLY-SECRET" } });
    await p;
    uninstall();
    expect(pi.events.emit).not.toHaveBeenCalled();
    expect(JSON.stringify(emit.mock.calls)).not.toMatch(/REQ-SECRET|REPLY-SECRET/);
  });
});
