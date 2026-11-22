/**
 * Server half of the plugin request/reply lane: success / throw / no_handler,
 * routing by (pluginId, type), duplicate registration, session attribution
 * from the socket key, priority independence, reply caps and serializability.
 * See change: expose-plugin-credential-and-oauth-seams (test-plan E23–E29).
 */
import type { PluginReplyMessage, PluginRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { describe, expect, it, vi } from "vitest";
import type { BridgeAdmission, BridgeChannel } from "../pi/bridge-channel.js";
import { createPluginRequestLane, PLUGIN_LANE_MAX_BYTES } from "../plugin-request-lane.js";
import { UNATTRIBUTED_REMOTE } from "../session/session-origin.js";

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

/**
 * D3: the lane carries the SENDING socket's origin + channel; a `hubLocalOnly` handler runs only for a
 * hub-local, locally admitted socket. See change: harden-bridge-session-claim (test-plan LA*).
 */
describe("plugin request lane: hub-local-only handlers", () => {
  const chan = (admission: BridgeAdmission): BridgeChannel => ({ admission, provenTls: false, ticketTls: false });
  const ADMISSIONS: BridgeAdmission[] = ["unix", "local-proof", "in-process", "device-ticket", "local-ticket", "legacy-token", "grace"];
  const LOCAL = new Set<BridgeAdmission>(["unix", "local-proof", "in-process"]);

  it("passes { sessionId, origin, channel } from the sending socket to any handler", async () => {
    const { lane, req } = setup();
    const h = vi.fn(() => "ok");
    lane.register("a", "t", h);
    await lane.handle("S1", req("a", "t"), { originDeviceId: "dev-1", channel: chan("device-ticket") });
    expect(h).toHaveBeenCalledWith({}, { sessionId: "S1", origin: { local: false, deviceId: "dev-1" }, channel: chan("device-ticket") });
  });

  it.each(ADMISSIONS)("hub-local origin + %s admission: runs only when locally admitted", async (admission) => {
    const { lane, sent, req } = setup();
    const h = vi.fn(() => ({ token: "T" }));
    lane.register("gmail", "lease", h, { hubLocalOnly: true });
    await lane.handle("S1", req("gmail", "lease"), { originDeviceId: undefined, channel: chan(admission) });
    if (LOCAL.has(admission)) {
      expect(h).toHaveBeenCalledTimes(1);
      expect(sent[0].msg).toMatchObject({ ok: true });
    } else {
      expect(h).not.toHaveBeenCalled();
      expect(sent[0].msg).toMatchObject({ ok: false });
      expect((sent[0].msg as { error: string }).error).toMatch(/^origin_denied: /);
    }
  });

  it.each(["dev-1", UNATTRIBUTED_REMOTE])("a remote origin (%s) is refused even on a locally admitted channel", async (originDeviceId) => {
    const { lane, sent, req } = setup();
    const h = vi.fn();
    lane.register("gmail", "lease", h, { hubLocalOnly: true });
    await lane.handle("S1", req("gmail", "lease"), { originDeviceId, channel: chan("unix") });
    expect(h).not.toHaveBeenCalled();
    expect((sent[0].msg as { error: string }).error).toMatch(/^origin_denied: /);
  });

  it("fails closed when the dispatch carried no conn (a hop dropped it) or no channel", async () => {
    const { lane, sent, req } = setup();
    const h = vi.fn();
    lane.register("gmail", "lease", h, { hubLocalOnly: true });
    await lane.handle("S1", req("gmail", "lease"));
    await lane.handle("S1", req("gmail", "lease"), { originDeviceId: undefined });
    expect(h).not.toHaveBeenCalled();
    expect(sent.map((s) => (s.msg as { error: string }).error)).toEqual([expect.stringMatching(/^origin_denied/), expect.stringMatching(/^origin_denied/)]);
  });

  it("a handler registered without the option stays reachable from a remote origin (additive seam)", async () => {
    const { lane, req } = setup();
    const h = vi.fn(() => 1);
    lane.register("browser", "open", h);
    await lane.handle("S1", req("browser", "open"), { originDeviceId: "dev-1", channel: chan("device-ticket") });
    expect(h).toHaveBeenCalledTimes(1);
  });

  it("logs origin_denied once per (plugin,type) per window, never the payload", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    const { lane, req } = setup();
    lane.register("gmail", "lease", () => 1, { hubLocalOnly: true });
    for (let i = 0; i < 3; i++) {
      await lane.handle("S1", req("gmail", "lease", { secret: "PAYLOAD" }, `r${i}`), { originDeviceId: "0123456789abcdef", channel: chan("device-ticket") });
    }
    spy.mockRestore();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("[plugin-request] origin_denied: gmail/lease session=S1 origin=01234567 admission=device-ticket");
    expect(lines[0]).not.toContain("PAYLOAD");
  });
});

describe("plugin request lane: spoofing, option variants, limiter windows (BE72-BE85)", () => {
  const chan = (admission: BridgeAdmission): BridgeChannel => ({ admission, provenTls: false, ticketTls: false });
  const ADMISSIONS: BridgeAdmission[] = ["unix", "local-proof", "in-process", "device-ticket", "local-ticket", "legacy-token", "grace"];

  it("BE73: a remote origin is denied under every one of the seven admissions (fail closed)", async () => {
    for (const admission of ADMISSIONS) {
      const { lane, sent, req } = setup();
      const h = vi.fn();
      lane.register("gmail", "lease", h, { hubLocalOnly: true });
      await lane.handle("S", req("gmail", "lease"), { originDeviceId: "dev-1", channel: chan(admission) });
      expect(h, admission).not.toHaveBeenCalled();
      expect((sent[0].msg as { error: string }).error).toMatch(/^origin_denied: \S/);
    }
  });

  it("BE75: no opts / {} / {hubLocalOnly:false} all stay reachable from a remote origin; duplicates still throw", async () => {
    const { lane, req } = setup();
    const seen: unknown[] = [];
    const variants: Array<[string, Parameters<typeof lane.register>[3]]> = [["a", undefined], ["b", {}], ["c", { hubLocalOnly: false }]];
    for (const [type, opts] of variants) {
      lane.register("p", type, (_p, meta) => { seen.push(meta); return 1; }, opts);
      await lane.handle("S", req("p", type), { originDeviceId: "dev-1", channel: chan("device-ticket") });
      expect(() => lane.register("p", type, () => 2, opts)).toThrow(/already registered/);
    }
    expect(seen).toHaveLength(3);
    for (const meta of seen) expect(meta).toMatchObject({ origin: { local: false, deviceId: "dev-1" }, channel: chan("device-ticket") });
  });

  it("BE76: a denied reply carries a non-empty detail and never echoes the payload", async () => {
    const { lane, sent, req } = setup();
    lane.register("gmail", "lease", () => 1, { hubLocalOnly: true });
    await lane.handle("S", req("gmail", "lease", { canary: "SECRET-CANARY-1" }), { originDeviceId: "dev-1", channel: chan("device-ticket") });
    const msg = sent[0].msg as { ok: boolean; error: string };
    expect(msg.ok).toBe(false);
    expect(msg.error).toMatch(/^origin_denied: .+/);
    expect(JSON.stringify(sent)).not.toContain("SECRET-CANARY-1");
  });

  it("BE77: a payload claiming a hub-local origin does not change the meta the handler sees", async () => {
    const { lane, req } = setup();
    const h = vi.fn(() => 1);
    lane.register("a", "who", h);
    await lane.handle("S-real", req("a", "who", { origin: { local: true }, sessionId: "hub-sess", hubLocal: true }), { originDeviceId: "dev-1", channel: chan("device-ticket") });
    const meta = (h.mock.calls[0] as unknown as [unknown, { origin: { local: boolean }; sessionId: string }])[1];
    expect(meta.origin.local).toBe(false);
    expect(meta.sessionId).toBe("S-real");
  });

  it("BE78: meta comes from conn, not from any session record or routing entry", async () => {
    // The lane has no access to a session record at all: a hub-local-only handler is denied for a remote conn.
    const { lane, sent, req } = setup();
    const h = vi.fn();
    lane.register("gmail", "lease", h, { hubLocalOnly: true });
    await lane.handle("S", req("gmail", "lease"), { originDeviceId: "dev-1", channel: chan("device-ticket") });
    expect(h).not.toHaveBeenCalled();
    expect((sent[0].msg as { error: string }).error).toMatch(/^origin_denied/);
  });

  it("BE79: with no conn, an unrestricted handler runs and sees no origin or channel", async () => {
    const { lane, req } = setup();
    const h = vi.fn(() => 1);
    lane.register("browser", "open", h);
    await lane.handle("S", req("browser", "open"));
    expect(h).toHaveBeenCalledWith({}, { sessionId: "S", origin: undefined, channel: undefined });
  });

  it("BE81: success/throw/no_handler/size outcomes are unchanged when a conn is supplied", async () => {
    const { lane, sent, req } = setup();
    const conn = { originDeviceId: undefined, channel: chan("unix") };
    const atCap = "x".repeat(PLUGIN_LANE_MAX_BYTES - 2);
    lane.register("a", "boom", () => { throw new Error("tier_denied"); });
    lane.register("a", "cap", () => atCap);
    lane.register("a", "over", () => `${atCap}x`);
    lane.register("a", "circ", () => { const o: Record<string, unknown> = {}; o.self = o; return o; });
    for (const t of ["boom", "cap", "over", "circ", "none"]) await lane.handle("S", req("a", t), conn);
    expect(sent.map((x) => (x.msg as { ok: boolean; error?: string }).error ?? "ok")).toEqual(["tier_denied", "ok", "reply_too_large", "reply_not_serializable", "no_handler"]);
  });

  it("BE82: the denial line names plugin/type, session, origin kind and admission; never the payload or the full device id", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    const { lane, req } = setup();
    lane.register("gmail", "lease", () => 1, { hubLocalOnly: true });
    await lane.handle("s-1", req("gmail", "lease", { c: "CANARY" }), { originDeviceId: "0123456789abcdef-FULL", channel: chan("device-ticket") });
    spy.mockRestore();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[plugin-request\] origin_denied: gmail\/lease session=s-1 origin=\S+ admission=device-ticket$/);
    expect(lines[0]).not.toMatch(/CANARY|FULL/);
  });

  it("BE83/BE84: the limiter is per (plugin,type) with a 5_000 ms window", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
    try {
      const { lane, sent, req } = setup();
      lane.register("gmail", "lease", () => 1, { hubLocalOnly: true });
      lane.register("gmail", "accounts", () => 1, { hubLocalOnly: true });
      const conn = { originDeviceId: "dev-1", channel: chan("device-ticket") };
      vi.setSystemTime(1_000_000);
      await lane.handle("S1", req("gmail", "lease"), conn);
      await lane.handle("S2", req("gmail", "lease"), conn); // same (plugin,type), other session: suppressed
      await lane.handle("S1", req("gmail", "accounts"), conn); // other type: own budget
      expect(lines).toHaveLength(2);
      for (const dt of [4_999, 5_000, 5_001]) {
        vi.setSystemTime(1_000_000 + dt);
        await lane.handle("S1", req("gmail", "lease"), conn);
      }
      // t0 (1) + t0+5000 (1) for lease, plus accounts at t0.
      expect(lines.filter((l) => l.includes("gmail/lease"))).toHaveLength(2);
      expect(sent.every((s) => /^origin_denied/.test((s.msg as { error: string }).error))).toBe(true);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("BE85: every BridgeAdmission value is classified (an 8th admission fails type-check until classified)", async () => {
    const { isLocallyAdmitted } = await import("../pi/bridge-channel.js");
    const classification: Record<BridgeAdmission, boolean> = {
      unix: true, "local-proof": true, "in-process": true,
      "device-ticket": false, "local-ticket": false, "legacy-token": false, grace: false,
    };
    for (const [adm, local] of Object.entries(classification)) expect(isLocallyAdmitted(adm as BridgeAdmission), adm).toBe(local);
  });
});

/**
 * A hub-local-only reply may carry a credential: it is delivered only to the socket that passed the gate. If the
 * routing entry moved while the handler awaited, the reply is dropped. See change: harden-bridge-session-claim.
 */
describe("hub-local-only reply is bound to the socket that passed the gate", () => {
  const chan = (admission: BridgeAdmission): BridgeChannel => ({ admission, provenTls: false, ticketTls: false });
  const make = (current: { c: BridgeChannel | undefined }) => {
    const sent: Array<{ sessionId: string; msg: PluginReplyMessage }> = [];
    const lane = createPluginRequestLane((sessionId, msg) => { sent.push({ sessionId, msg }); }, { currentChannel: () => current.c });
    const req = (): PluginRequestMessage => ({ type: "plugin_request", requestId: "r", pluginId: "gmail", messageType: "lease", payload: {} });
    return { lane, sent, req };
  };

  it("delivers when the entry still belongs to the sender", async () => {
    const sender = chan("unix");
    const { lane, sent, req } = make({ c: sender });
    lane.register("gmail", "lease", async () => ({ token: "T" }), { hubLocalOnly: true });
    await lane.handle("S", req(), { originDeviceId: undefined, channel: sender });
    expect(sent).toHaveLength(1);
  });

  it("drops the reply when a different socket (even same origin, grace admission) took the entry during the await", async () => {
    const sender = chan("unix");
    const current: { c: BridgeChannel | undefined } = { c: sender };
    const { lane, sent, req } = make(current);
    lane.register("gmail", "lease", async () => { current.c = chan("grace"); return { token: "SECRET" }; }, { hubLocalOnly: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await lane.handle("S", req(), { originDeviceId: undefined, channel: sender });
    spy.mockRestore();
    expect(sent).toEqual([]);
  });

  it("also drops when the entry is gone (sender closed, nobody holds the id)", async () => {
    const sender = chan("unix");
    const current: { c: BridgeChannel | undefined } = { c: sender };
    const { lane, sent, req } = make(current);
    lane.register("gmail", "lease", async () => { current.c = undefined; return 1; }, { hubLocalOnly: true });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await lane.handle("S", req(), { originDeviceId: undefined, channel: sender });
    spy.mockRestore();
    expect(sent).toEqual([]);
  });

  it("an unrestricted handler's reply is not bound (its reply carries no hub-only secret)", async () => {
    const sender = chan("device-ticket");
    const { lane, sent, req } = make({ c: undefined });
    lane.register("gmail", "lease", async () => 1);
    await lane.handle("S", req(), { originDeviceId: "dev-1", channel: sender });
    expect(sent).toHaveLength(1);
  });
});

