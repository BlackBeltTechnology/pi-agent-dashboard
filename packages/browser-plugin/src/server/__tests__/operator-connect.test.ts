/**
 * Host-targeted connect + operator link stream (change:
 * add-operator-browser-relay, tasks 7.3 / 7.4 / 7.7) — test-plan #E12–#E24,
 * #E29 (audit), #X1–#X6, #X8, #X9.
 *
 * A real `RelayManager` + real `RelayInstance`; the operator is a `FakeCarrier`
 * driven message-by-message exactly as Electron main (through the SPA's `/ws`)
 * would, so what is pinned is the wire contract of design D3–D6.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import {
  answerConnect,
  attachLinkedExtension,
  completeConnect,
  FakeCarrier,
  type HostIdentity,
  lastConnect,
  makeIdentity,
  profileRows,
  registerHost,
  SERVER_ID,
} from "../relay/__tests__/fake-host.js";
import { type FakeSocket, flush, socketPair } from "../relay/__tests__/fake-socket.js";
import { LINK_MAX_DATA } from "../relay/link-socket.js";
import { type RelayConfig, RelayManager } from "../relay/relay-manager.js";

const GUID = "0123456789abcdef0123456789abcdef";
const MiB = 1024 * 1024;

interface World {
  manager: RelayManager;
  audit: AuditRing;
  logs: string[];
  carrier: FakeCarrier;
  id: HostIdentity;
  config: RelayConfig;
  chromeOpens: Array<{ profile: string; url: string }>;
  closed: string[];
}

interface WorldOpts {
  profiles?: Array<Record<string, unknown>>;
  config?: RelayConfig;
  connectTimeoutMs?: number;
  consentTimeoutMs?: number;
  register?: boolean;
}

async function makeWorld(opts: WorldOpts = {}): Promise<World> {
  const audit = new AuditRing();
  const logs: string[] = [];
  const chromeOpens: World["chromeOpens"] = [];
  const closed: string[] = [];
  const config: RelayConfig = opts.config ?? { enabled: true, browsers: { Default: { token: "T0KEN-secret", zeroDialog: true } } };
  const logger = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
  const manager = new RelayManager({
    audit,
    logger,
    getConfig: () => config,
    getPort: () => 8123,
    canOpenChrome: () => true,
    listProfiles: async () => ({ profiles: [{ profileDirectory: "Default", label: "Default", installed: true }] }),
    openChrome: (profile, url) => {
      chromeOpens.push({ profile, url });
      const guid = new URL(url).searchParams.get("mcpRelayUrl")!.split("/").pop()!;
      const [relayExt, extSide] = socketPair();
      manager.attachExtension(guid, relayExt);
      void extSide;
    },
    onStatusChange: () => {},
    onInstanceClosed: (id) => closed.push(id),
    operatorHosts: { getServerId: async () => SERVER_ID },
    connectTimeoutMs: opts.connectTimeoutMs,
    consentTimeoutMs: opts.consentTimeoutMs,
    randomGuid: () => GUID,
  });
  const carrier = new FakeCarrier();
  const id = makeIdentity();
  if (opts.register !== false) await registerHost(manager, carrier, id, opts.profiles ?? profileRows(1));
  return { manager, audit, logs, carrier, id, config, chromeOpens, closed };
}

/** Full successful operator connect; resolves with the CDP url + the host's link handle. */
async function connectLive(w: World, profile = "Default") {
  const pending = w.manager.connect(profile, w.id.hostId);
  const link = completeConnect(w.manager, w.carrier);
  const result = await pending;
  return { result, ...link };
}

const hostMsgs = (s: FakeSocket) => s.json().filter((m) => String(m.type).startsWith("browser_host_"));
const connectLines = (w: World) => w.logs.filter((l) => l.startsWith("[browser-host] connect "));
const hostAudit = (w: World, host = w.id.hostId) => w.audit.list(`host:${host}`);

afterEach(() => vi.useRealTimers());

describe("successful operator connect (E12)", () => {
  it("returns a loopback cdpUrl on the dashboard port and sends the guid to nobody", async () => {
    const w = await makeWorld();
    const { result, linkId, instanceId } = await connectLive(w);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cdpUrl).toBe(`ws://127.0.0.1:8123/ws/browser-cdp/${GUID}`); // the one place the guid is legitimate
    expect(result.instanceId).toBe(instanceId);

    // Nothing sent to any socket carries the guid; the link is addressed by linkId only.
    expect(w.carrier.sent.join("\n")).not.toContain(GUID);
    expect(linkId).not.toBe(GUID);
    expect(linkId).toMatch(/^[0-9a-f]{32}$/);
    // The connect message is exactly the D3 shape.
    expect(w.carrier.ofType("browser_host_connect")[0]).toEqual({
      type: "browser_host_connect",
      requestId: expect.any(String),
      linkId,
      instanceId,
      profileDirectory: "Default",
      serverLabel: "127.0.0.1:8123",
    });
    // Dashboard Chrome was never launched, and the dashboard token never leaves S.
    expect(w.chromeOpens).toHaveLength(0);
    expect(w.carrier.sent.join("\n")).not.toContain("T0KEN-secret");
  });

  it("the agent's CDP traffic reaches the operator's Chrome through browser_host_relay_data", async () => {
    const w = await makeWorld();
    const { result } = await connectLive(w);
    expect(result.ok).toBe(true);
    const [relayCdp, agent] = socketPair();
    expect(w.manager.attachCdp(GUID, relayCdp)).toBe(true);
    agent.send(JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } }));
    await flush();
    const relayed = w.carrier.ofType("browser_host_relay_data");
    expect(relayed.length).toBeGreaterThan(0);
    expect(agent.receivedJson().some((m) => m.id === 1)).toBe(true);
  });

  it("instance rows carry host:<hostId>; the attach audit names the host and no id", async () => {
    const w = await makeWorld();
    await connectLive(w);
    expect(w.manager.instances()[0].host).toBe(w.id.hostId);
    const attach = w.audit.list().find((e) => e.kind === "attach");
    expect(attach?.detail).toContain(`host:${w.id.hostId}`);
    const blob = JSON.stringify([w.audit.list(), w.logs]);
    expect(blob).not.toContain(GUID);
    expect(blob).not.toContain(lastConnect(w.carrier).linkId);
  });
});

describe("outcome table (E13)", () => {
  it("disabled → 403", async () => {
    const w = await makeWorld({ config: { enabled: false } });
    expect(await w.manager.connect("Default", w.id.hostId)).toEqual({ ok: false, status: 403, reason: "disabled" });
    expect(hostMsgs(w.carrier).filter((m) => m.type === "browser_host_connect")).toHaveLength(0);
  });

  it("unknown host → 404 unknown-host, no guid minted, nothing sent", async () => {
    const w = await makeWorld();
    const other = `host-${"9".repeat(32)}`;
    expect(await w.manager.connect("Default", other)).toEqual({ ok: false, status: 404, reason: "unknown-host" });
    expect(w.manager.instances()).toHaveLength(0);
    expect(hostMsgs(w.carrier).filter((m) => m.type === "browser_host_connect")).toHaveLength(0);
  });

  it("profile absent from the host's rows → 409 not-installed", async () => {
    const w = await makeWorld();
    expect(await w.manager.connect("Nope", w.id.hostId)).toEqual({ ok: false, status: 409, reason: "not-installed" });
  });

  it("installed:false → 409 not-installed", async () => {
    const w = await makeWorld({ profiles: [{ profileDirectory: "Default", label: "x", installed: false }] });
    expect(await w.manager.connect("Default", w.id.hostId)).toEqual({ ok: false, status: 409, reason: "not-installed" });
  });

  it("live instance on (host, profile) → 409 busy with its instanceId (E18: first unaffected)", async () => {
    const w = await makeWorld();
    const first = await connectLive(w);
    expect(first.result.ok).toBe(true);
    const second = await w.manager.connect("Default", w.id.hostId);
    expect(second).toEqual({ ok: false, status: 409, reason: "busy", instanceId: first.instanceId });
    expect(w.manager.instances()).toHaveLength(1);
    expect(w.manager.instances()[0].statusState()).toBe("no-cdp-client"); // untouched, still handshaken
    expect(w.carrier.ofType("browser_host_connect")).toHaveLength(1);
  });

  it("pending connect on (host, profile) → 409 busy WITHOUT an instanceId; exactly one browser_host_connect (E16)", async () => {
    const w = await makeWorld();
    const first = w.manager.connect("Default", w.id.hostId);
    const second = await w.manager.connect("Default", w.id.hostId);
    expect(second).toEqual({ ok: false, status: 409, reason: "busy" });
    expect(w.carrier.ofType("browser_host_connect")).toHaveLength(1);
    answerConnect(w.manager, w.carrier, false, "denied");
    await first;
  });

  it("8 links on the host → 409 host-busy", async () => {
    const w = await makeWorld({ profiles: profileRows(10) });
    for (let i = 0; i < 8; i++) {
      const { result } = await connectLive(w, profileRows(10)[i].profileDirectory);
      expect(result.ok).toBe(true);
    }
    expect(await w.manager.connect("Profile 8", w.id.hostId)).toEqual({ ok: false, status: 409, reason: "host-busy" });
  });

  it("2 pending connects on the host → 409 host-busy for a third profile", async () => {
    const w = await makeWorld({ profiles: profileRows(4) });
    const a = w.manager.connect("Default", w.id.hostId);
    const b = w.manager.connect("Profile 1", w.id.hostId);
    expect(await w.manager.connect("Profile 2", w.id.hostId)).toEqual({ ok: false, status: 409, reason: "host-busy" });
    expect(w.carrier.ofType("browser_host_connect")).toHaveLength(2);
    for (const rid of w.carrier.ofType("browser_host_connect").map((m) => m.requestId as string)) {
      answerConnect(w.manager, w.carrier, false, "denied", rid);
    }
    await Promise.all([a, b]);
  });

  it.each([
    ["denied", 403, "operator-denied"],
    ["no-chrome", 503, "no-chrome"],
    ["boom", 503, "launch-failed"],
    ["server-unverified", 503, "launch-failed"],
  ] as const)("connect_result ok:false reason=%s → %s %s, host gets cancel, link discarded", async (reason, status, mapped) => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    const { requestId, linkId } = lastConnect(w.carrier);
    answerConnect(w.manager, w.carrier, false, reason);
    expect(await p).toEqual({ ok: false, status, reason: mapped });
    expect(w.carrier.ofType("browser_host_connect_cancel")).toEqual([{ type: "browser_host_connect_cancel", requestId }]);
    expect(w.manager.instances()).toHaveLength(0);
    // the discarded link can no longer be opened
    w.manager.handleHostMessage({ type: "browser_host_ext_open", linkId }, w.carrier);
    expect(hostAudit(w).some((e) => e.detail === "browser_host:ext_open")).toBe(true);
  });
});

describe("dashboard path is unchanged (E14, E15)", () => {
  it("a live dashboard `Default` does not make an operator `Default` busy (E14)", async () => {
    const w = await makeWorld();
    // a live dashboard-host instance on Default
    const dash = w.manager.connect("Default");
    await flush();
    expect(w.chromeOpens).toHaveLength(1);
    void dash.catch(() => {});

    const op = w.manager.connect("Default", w.id.hostId);
    expect(w.carrier.ofType("browser_host_connect")).toHaveLength(1);
    answerConnect(w.manager, w.carrier, false, "denied");
    expect((await op).ok).toBe(false);
  });

  it("no host / host:\"dashboard\" → dashboard openChrome each, zero browser_host_* sent (E15)", async () => {
    const w = await makeWorld({ config: { enabled: true, allowMultipleInstancesPerProfile: true, browsers: { Default: {} } }, connectTimeoutMs: 20 });
    const before = hostMsgs(w.carrier).length;
    await w.manager.connect("Default");
    await w.manager.connect("Default", "dashboard");
    expect(w.chromeOpens).toHaveLength(2);
    expect(hostMsgs(w.carrier)).toHaveLength(before);
    // the dashboard connect URL still carries the dashboard guid + token config
    expect(w.chromeOpens[0].url).toContain("mcpRelayUrl");
  });
});

describe("link stream ownership and ordering (E19–E22)", () => {
  it("ext_open before connect_result is dropped + audited; the connect keeps waiting (E19)", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    const { linkId } = lastConnect(w.carrier);
    w.manager.handleHostMessage({ type: "browser_host_ext_open", linkId }, w.carrier);
    const denied = hostAudit(w).filter((e) => e.kind === "denied");
    expect(denied.map((e) => e.detail)).toEqual(["browser_host:ext_open"]);
    expect(w.manager.instances()).toHaveLength(1); // still pending
    // and the proper flow still completes afterwards
    completeConnect(w.manager, w.carrier);
    expect((await p).ok).toBe(true);
  });

  it("another socket naming a live link / request is ignored and audited ×3; the link survives (E20)", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    expect(live.result.ok).toBe(true);
    const { requestId } = lastConnect(w.carrier);
    const intruder = new FakeCarrier();
    w.manager.handleHostMessage({ type: "browser_host_ext_data", linkId: live.linkId, data: "{}" }, intruder);
    w.manager.handleHostMessage({ type: "browser_host_ext_close", linkId: live.linkId, code: 1000 }, intruder);
    w.manager.handleHostMessage({ type: "browser_host_connect_result", requestId, ok: false }, intruder);
    expect(hostAudit(w).filter((e) => e.kind === "denied").map((e) => e.detail).sort()).toEqual([
      "browser_host:connect_result",
      "browser_host:ext_close",
      "browser_host:ext_data",
    ]);
    expect(w.manager.instances()).toHaveLength(1);
    expect(w.manager.instances()[0].statusState()).toBe("no-cdp-client");
    expect(intruder.sent).toHaveLength(0);
    // a hostile id never lands in the audit text
    expect(JSON.stringify(w.audit.list())).not.toContain(live.linkId);
  });

  it("an unbound socket naming an unknown link is audited under host:invalid, ids not echoed", async () => {
    const w = await makeWorld();
    const stranger = new FakeCarrier();
    w.manager.handleHostMessage({ type: "browser_host_ext_data", linkId: "evil\nid", data: "x" }, stranger);
    expect(w.audit.list("host:invalid")).toHaveLength(1);
    expect(JSON.stringify(w.audit.list())).not.toContain("evil");
  });

  it("data of 16 MiB is delivered; 16 MiB + 1 closes the link 1009 and the instance (E21)", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    expect(live.result.ok).toBe(true);
    const shell = JSON.stringify({ method: "x.y", params: "" });
    const pad = (n: number) => shell.replace('""', `"${"a".repeat(n - shell.length)}"`);
    const ok = pad(LINK_MAX_DATA);
    expect(ok.length).toBe(LINK_MAX_DATA);
    w.manager.handleHostMessage({ type: "browser_host_ext_data", linkId: live.linkId, data: ok }, w.carrier);
    expect(w.manager.instances()).toHaveLength(1);

    w.manager.handleHostMessage({ type: "browser_host_ext_data", linkId: live.linkId, data: `${ok}a` }, w.carrier);
    expect(w.carrier.ofType("browser_host_relay_close").at(-1)).toMatchObject({ linkId: live.linkId, code: 1009 });
    expect(w.manager.instances()).toHaveLength(0);
    expect(w.closed).toEqual([live.instanceId]);
  });

  it("non-string data and a second ext_open are dropped + audited; the link stays alive (E22)", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    w.manager.handleHostMessage({ type: "browser_host_ext_data", linkId: live.linkId, data: 42 }, w.carrier);
    w.manager.handleHostMessage({ type: "browser_host_ext_open", linkId: live.linkId }, w.carrier);
    expect(hostAudit(w).filter((e) => e.kind === "denied").map((e) => e.detail).sort()).toEqual([
      "browser_host:ext_data",
      "browser_host:ext_open",
    ]);
    expect(w.manager.instances()).toHaveLength(1);
    expect(w.carrier.ofType("browser_host_relay_close")).toHaveLength(0);
  });

  it("ext_close from the owner closes the link and the instance; a trailing ext_close is not called hostile", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    w.manager.handleHostMessage({ type: "browser_host_ext_close", linkId: live.linkId, code: 1000 }, w.carrier);
    expect(w.manager.instances()).toHaveLength(0);
    const before = w.audit.list().length;
    w.manager.handleHostMessage({ type: "browser_host_ext_close", linkId: live.linkId, code: 1000 }, w.carrier);
    w.manager.handleHostMessage({ type: "browser_host_ext_data", linkId: live.linkId, data: "{}" }, w.carrier);
    expect(w.audit.list().length).toBe(before);
    expect(w.logs.some((l) => l.startsWith("[browser-host] link close host="))).toBe(true);
  });

  it("malformed / unknown browser_host_* messages are dropped without throwing", async () => {
    const w = await makeWorld();
    expect(() => {
      w.manager.handleHostMessage(null, w.carrier);
      w.manager.handleHostMessage("nope", w.carrier);
      w.manager.handleHostMessage({ type: 5 }, w.carrier);
      w.manager.handleHostMessage({ type: "browser_host_tee", linkId: "x" }, w.carrier);
    }).not.toThrow();
  });
});

describe("deny-list and unicast (E23, E24)", () => {
  it("Network.getAllCookies on a linked instance → -32000 and nothing is relayed (E23)", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    expect(live.result.ok).toBe(true);
    const [relayCdp, agent] = socketPair();
    w.manager.attachCdp(GUID, relayCdp);
    agent.send(JSON.stringify({ id: 9, method: "Network.getAllCookies", params: {} }));
    await flush();
    const resp = agent.receivedJson().find((m) => m.id === 9)!;
    expect((resp.error as { code: number }).code).toBe(-32000);
    expect(w.carrier.ofType("browser_host_relay_data").some((m) => String(m.data).includes("Network.getAllCookies"))).toBe(false);
  });

  it("only the carrier receives browser_host_*; a plain client gets none through a full cycle (E24)", async () => {
    const w = await makeWorld();
    const plain = new FakeCarrier();
    const live = await connectLive(w);
    expect(live.result.ok).toBe(true);
    const inst = w.manager.instances()[0];
    await flush();
    // a plain viewer subscribes (normal mode) and a frame flows; the carrier tees locally
    const [relayCdp, agent] = socketPair();
    w.manager.attachCdp(GUID, relayCdp);
    agent.send(JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } }));
    await flush();
    inst.subscribe(plain, 7);
    inst.subscribe(w.carrier, 7, { local: true });
    live.ext.emitFrame(7);
    await flush();
    w.manager.disconnect(live.instanceId);
    await flush();
    expect(hostMsgs(plain)).toEqual([]);
    expect(plain.json().some((m) => m.type === "browser_relay_frame")).toBe(true);
    expect(hostMsgs(w.carrier).map((m) => m.type)).toEqual(
      expect.arrayContaining(["browser_host_connect", "browser_host_relay_data", "browser_host_tee"]),
    );
  });
});

describe("timers (X1–X3)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));

  it("ok:true at +50 s and the handshake at +70 s still resolves 200 (X1)", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    await vi.advanceTimersByTimeAsync(50_000);
    const { linkId } = lastConnect(w.carrier);
    answerConnect(w.manager, w.carrier, true);
    const ext = attachLinkedExtension(w.manager, w.carrier, linkId);
    w.manager.handleHostMessage({ type: "browser_host_ext_open", linkId }, w.carrier);
    await vi.advanceTimersByTimeAsync(20_000); // +70 s: past the request's 60 s, inside 60 s of ok:true
    ext.initialize();
    await vi.advanceTimersByTimeAsync(10);
    expect((await p).ok).toBe(true);
  });

  it("no answer for 60 s → 504 consent-timeout and the host gets connect_cancel (X2)", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    const { requestId } = lastConnect(w.carrier);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(w.carrier.ofType("browser_host_connect_cancel")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: false, status: 504, reason: "consent-timeout" });
    expect(w.carrier.ofType("browser_host_connect_cancel")).toEqual([{ type: "browser_host_connect_cancel", requestId }]);
    expect(w.manager.instances()).toHaveLength(0);
  });

  it("ok:true at +5 s but no ext_open → 504 at +65 s, cancel sent, the link id is dead (X3)", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    const { requestId, linkId } = lastConnect(w.carrier);
    await vi.advanceTimersByTimeAsync(5_000);
    answerConnect(w.manager, w.carrier, true);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(w.carrier.ofType("browser_host_connect_cancel")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toMatchObject({ ok: false, status: 504 });
    expect(w.carrier.ofType("browser_host_connect_cancel")).toEqual([{ type: "browser_host_connect_cancel", requestId }]);
    w.manager.handleHostMessage({ type: "browser_host_ext_open", linkId }, w.carrier);
    expect(hostAudit(w).some((e) => e.detail === "browser_host:ext_open")).toBe(true);
    expect(w.manager.instances()).toHaveLength(0);
  });

  it("a late connect_result after the consent timeout is ignored quietly", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    const { requestId } = lastConnect(w.carrier);
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
    const before = w.audit.list().length;
    answerConnect(w.manager, w.carrier, true, undefined, requestId);
    expect(w.audit.list().length).toBe(before);
    expect(w.manager.instances()).toHaveLength(0);
  });

  it("all connect lines: one per request with the right outcome, no secrets (X9)", async () => {
    const w = await makeWorld({ profiles: profileRows(3) });
    const ok = w.manager.connect("Default", w.id.hostId);
    const link = completeConnect(w.manager, w.carrier);
    await ok;
    const denied = w.manager.connect("Profile 1", w.id.hostId);
    answerConnect(w.manager, w.carrier, false, "denied");
    await denied;
    const timeout = w.manager.connect("Profile 2", w.id.hostId);
    await vi.advanceTimersByTimeAsync(60_000);
    await timeout;
    await w.manager.connect("Default", `host-${"7".repeat(32)}`);

    const lines = connectLines(w);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(new RegExp(`^\\[browser-host\\] connect host=${w.id.hostId} profile=Default outcome=200 ms=\\d+$`));
    expect(lines[1]).toMatch(/profile=Profile 1 outcome=operator-denied ms=\d+$/);
    expect(lines[2]).toMatch(/profile=Profile 2 outcome=consent-timeout ms=\d+$/);
    expect(lines[3]).toMatch(/host=host-7{32} profile=Default outcome=unknown-host ms=\d+$/);

    const everything = JSON.stringify([w.logs, w.audit.list()]);
    for (const secret of [GUID, link.linkId, link.requestId, "T0KEN-secret"]) expect(everything).not.toContain(secret);
    const challenge = w.carrier.ofType("browser_host_challenge")[0].nonce as string;
    expect(everything).not.toContain(challenge);
  });

  it("log tokens built from request text cannot inject lines", async () => {
    const w = await makeWorld();
    await w.manager.connect("Default\nFORGED [browser-host] connect", "not-a-host\nx");
    expect(w.logs.every((l) => !l.includes("\n"))).toBe(true);
    expect(connectLines(w)).toHaveLength(1);
    expect(connectLines(w)[0]).toContain("host=invalid");
  });
});

describe("lifecycle (X4–X6, X8)", () => {
  it("carrier closes after browser_host_connect → 503 host-gone (X4)", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    w.carrier.close(1006, "tab closed");
    expect(await p).toEqual({ ok: false, status: 503, reason: "host-gone" });
    expect(w.manager.instances()).toHaveLength(0);
    expect(w.manager.hosts.list()).toEqual([]);
  });

  it("carrier closes between ok:true and the handshake → 503 host-gone", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    const { linkId } = lastConnect(w.carrier);
    answerConnect(w.manager, w.carrier, true);
    w.manager.handleHostMessage({ type: "browser_host_ext_open", linkId }, w.carrier);
    w.carrier.close(1006, "gone");
    expect(await p).toEqual({ ok: false, status: 503, reason: "host-gone" });
  });

  it("carrier close with a live instance: closed reason host-gone, CDP socket closed, host offline (X5)", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    expect(live.result.ok).toBe(true);
    const [relayCdp, agent] = socketPair();
    w.manager.attachCdp(GUID, relayCdp);
    w.carrier.close(1006, "gone");
    expect(w.manager.instances()).toHaveLength(0);
    expect(agent.closed.length).toBeGreaterThan(0);
    expect(w.logs.some((l) => l === `[browser-host] link close host=${w.id.hostId} reason=host-gone`)).toBe(true);
    expect(w.manager.hosts.list()).toEqual([]);
    expect(w.closed).toEqual([live.instanceId]);
  });

  it("kill switch closes the linked instance before the PUT resolves; host connects → 403 (X6)", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    expect(live.result.ok).toBe(true);
    w.config.enabled = false;
    await w.manager.setEnabled(false);
    expect(w.manager.instances()).toHaveLength(0);
    expect(await w.manager.connect("Default", w.id.hostId)).toEqual({ ok: false, status: 403, reason: "disabled" });
  });

  it("kill switch during consent → 403 disabled, host cancelled", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    w.config.enabled = false;
    await w.manager.setEnabled(false);
    expect(await p).toMatchObject({ ok: false, status: 403, reason: "disabled" });
  });

  it("kill switch flipped while consent is answered ok → no link is opened (epoch re-check)", async () => {
    const w = await makeWorld();
    const p = w.manager.connect("Default", w.id.hostId);
    const { linkId } = lastConnect(w.carrier);
    w.config.enabled = false;
    answerConnect(w.manager, w.carrier, true);
    expect(await p).toMatchObject({ ok: false, status: 403 });
    w.manager.handleHostMessage({ type: "browser_host_ext_open", linkId }, w.carrier);
    expect(w.manager.instances()).toHaveLength(0);
  });

  it("carrier > 32 MiB for 10 s closes every link 1013 carrier-congested and their instances (X8)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const w = await makeWorld({ profiles: profileRows(2) });
    const a = await connectLive(w, "Default");
    const b = await connectLive(w, "Profile 1");
    expect(a.result.ok && b.result.ok).toBe(true);
    w.carrier.bufferedAmount = 33 * MiB;
    await vi.advanceTimersByTimeAsync(9_900);
    expect(w.manager.instances()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.manager.instances()).toHaveLength(0);
    const closes = w.carrier.ofType("browser_host_relay_close");
    expect(closes.map((m) => [m.code, m.reason])).toEqual([
      [1013, "carrier-congested"],
      [1013, "carrier-congested"],
    ]);
    expect(new Set(closes.map((m) => m.linkId))).toEqual(new Set([a.linkId, b.linkId]));
  });
});

describe("endpoint isolation (E17 manager side)", () => {
  it("resolve() flags an operator guid; attachExtension on it is refused (no direct dial)", async () => {
    const w = await makeWorld();
    void w.manager.connect("Default", w.id.hostId);
    expect(w.manager.resolve(GUID)).toMatchObject({ operator: true, claimed: false });
    const [relayExt] = socketPair();
    expect(w.manager.attachExtension(GUID, relayExt)).toBe(false);
    expect(relayExt.closed).toEqual([]);
    // H's ext_open still attaches afterwards
    completeConnect(w.manager, w.carrier);
    await flush();
    expect(w.manager.resolve(GUID)).toMatchObject({ operator: true, claimed: true });
  });

  it("a dashboard guid resolves with operator:false", async () => {
    const w = await makeWorld({ connectTimeoutMs: 1000 });
    void w.manager.connect("Default").catch(() => {});
    await flush();
    expect(w.manager.resolve(GUID)).toMatchObject({ operator: false });
  });
});

describe("host-active and re-bind with real activity", () => {
  it("a second socket registering the same host while a link is live is refused; the instance survives (E5)", async () => {
    const w = await makeWorld();
    const live = await connectLive(w);
    expect(live.result.ok).toBe(true);
    const intruder = new FakeCarrier();
    await registerHost(w.manager, intruder, w.id);
    expect(intruder.ofType("browser_host_registered")).toHaveLength(0);
    expect(w.manager.instances()).toHaveLength(1);
    expect(w.manager.hosts.get(w.id.hostId)?.socket).toBe(w.carrier);
  });

  it("after the carrier closes the host re-registers on a new socket (E6)", async () => {
    const w = await makeWorld();
    await connectLive(w);
    w.carrier.close(1006, "x");
    const fresh = new FakeCarrier();
    await registerHost(w.manager, fresh, w.id);
    expect(fresh.ofType("browser_host_registered")).toHaveLength(1);
    expect(w.manager.hosts.list()[0].online).toBe(true);
  });
});
