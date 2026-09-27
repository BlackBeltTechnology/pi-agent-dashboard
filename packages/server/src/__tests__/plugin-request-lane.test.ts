/**
 * Server half of the plugin request/reply lane: success / throw / no_handler,
 * routing by (pluginId, type), duplicate registration, session attribution
 * from the socket key, priority independence, reply caps and serializability.
 * See change: expose-plugin-credential-and-oauth-seams (test-plan E23–E29).
 */
import type { PluginReplyMessage, PluginRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { describe, expect, it, vi } from "vitest";
import { createPluginRequestLane, PLUGIN_LANE_MAX_BYTES } from "../plugin-request-lane.js";

function setup() {
  const sent: Array<{ sessionId: string; msg: PluginReplyMessage }> = [];
  const lane = createPluginRequestLane((sessionId, msg) => { sent.push({ sessionId, msg }); });
  const req = (pluginId: string, messageType: string, payload: unknown = {}, requestId = "r1"): PluginRequestMessage =>
    ({ type: "plugin_request", requestId, pluginId, messageType, payload });
  return { lane, sent, req };
}

describe("plugin request lane", () => {
  it("E23: success, handler throw (message only), and no_handler", async () => {
    const { lane, sent, req } = setup();
    lane.register("a", "ok", () => ({ t: 1 }));
    lane.register("a", "bad", () => { throw new Error("tier_denied"); });
    await lane.handle("S1", req("a", "ok", {}, "1"));
    await lane.handle("S1", req("a", "bad", {}, "2"));
    await lane.handle("S1", req("a", "missing", {}, "3"));
    expect(sent.map((s) => s.msg)).toEqual([
      { type: "plugin_reply", requestId: "1", ok: true, result: { t: 1 } },
      { type: "plugin_reply", requestId: "2", ok: false, error: "tier_denied" },
      { type: "plugin_reply", requestId: "3", ok: false, error: "no_handler" },
    ]);
    expect(JSON.stringify(sent)).not.toContain("stack");
    expect(sent.every((s) => s.sessionId === "S1")).toBe(true);
  });

  it("E24: routes by plugin id", async () => {
    const { lane, req } = setup();
    const a = vi.fn(() => "a");
    const b = vi.fn(() => "b");
    lane.register("a", "lease", a);
    lane.register("b", "lease", b);
    await lane.handle("S1", req("b", "lease"));
    expect(a).toHaveBeenCalledTimes(0);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("E25: a duplicate (pluginId, type) registration throws", () => {
    const { lane } = setup();
    lane.register("a", "lease", () => 1);
    expect(() => lane.register("a", "lease", () => 2)).toThrow(/already registered/);
    expect(() => lane.register("b", "lease", () => 2)).not.toThrow();
  });

  it("E26: the handler sees the socket's session id, not the payload's", async () => {
    const { lane, req } = setup();
    const h = vi.fn();
    lane.register("a", "who", h);
    await lane.handle("S1", req("a", "who", { sessionId: "S2" }));
    expect(h).toHaveBeenCalledWith({ sessionId: "S2" }, { sessionId: "S1" });
  });

  it("E27: replies are sent host-internally, independent of plugin priority", async () => {
    // The lane has no priority input at all: a priority-1000 plugin's handler
    // is answered through the same host send as any other.
    const { lane, sent, req } = setup();
    lane.register("low-priority-1000", "ping", () => "pong");
    await lane.handle("S1", req("low-priority-1000", "ping"));
    expect(sent[0].msg).toMatchObject({ ok: true, result: "pong" });
  });

  it("E28: a reply over 256 KiB fails reply_too_large; at the cap it passes", async () => {
    const { lane, sent, req } = setup();
    const atCap = "x".repeat(PLUGIN_LANE_MAX_BYTES - 2); // JSON quotes
    lane.register("a", "cap", () => atCap);
    lane.register("a", "over", () => `${atCap}x`);
    await lane.handle("S1", req("a", "cap", {}, "1"));
    await lane.handle("S1", req("a", "over", {}, "2"));
    expect(sent[0].msg.ok).toBe(true);
    expect(sent[1].msg).toEqual({ type: "plugin_reply", requestId: "2", ok: false, error: "reply_too_large" });
  });

  it("E29: a circular reply fails reply_not_serializable", async () => {
    const { lane, sent, req } = setup();
    lane.register("a", "circ", () => { const o: Record<string, unknown> = {}; o.self = o; return o; });
    await lane.handle("S1", req("a", "circ"));
    expect(sent[0].msg).toMatchObject({ ok: false, error: "reply_not_serializable" });
  });
});
