/**
 * R4: a bridge holding the local token requires a server counter-proof on EVERY
 * loopback dial (`ws:` and `wss:`), whatever the spawn marker says; only an
 * explicit opt-out skips it, and `ws+unix:` is exempt.
 *
 * Covers test-plan BE21, BE22, BE23, BE24, BX1, BX2, BX3.
 * See change: harden-bridge-inbound-and-discovery (D19).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  LOCAL_PROOF_HEADER,
  LOCAL_PROOF_SERVER_HEADER,
  parseProof,
  serverCounterProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager, type IdentityFailureReport } from "../connection.js";
import {
  ALLOW_UNPROVEN_LOCAL_SERVER_ENV,
  localCredentialPlan,
  markerEnforces,
  proofFailureLogCause,
  requiresServerProof,
} from "../local-token-header.js";
import { probeServerProof, verifyDiscoveredCandidate } from "../server-proof-probe.js";

const TOKEN = "r4-local-token";
let home: string;
const sockets: net.Socket[] = [];

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "r4-home-"));
  const dir = path.join(home, ".pi", "dashboard", "local");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "token"), `${TOKEN}\n`);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  for (const s of sockets.splice(0)) s.destroy();
});

function fakeConnect(remoteAddress = "127.0.0.1") {
  return async (_host: string, port: number) => {
    const socket = new net.Socket();
    Object.defineProperty(socket, "remoteAddress", { value: remoteAddress });
    Object.defineProperty(socket, "remotePort", { value: port });
    sockets.push(socket);
    return socket;
  };
}

type UpgradeHeaders = Record<string, string | string[] | undefined>;

class FakeWs {
  static instances: FakeWs[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  terminated = false;
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  url: string;
  opts?: { headers?: Record<string, string>; createConnection?: () => unknown };
  constructor(url: string, opts?: { headers?: Record<string, string>; createConnection?: () => unknown }) {
    this.url = url;
    this.opts = opts;
    FakeWs.instances.push(this);
  }
  on(ev: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of this.handlers.get(ev) ?? []) fn(...a);
  }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; }
  terminate() { this.terminated = true; this.readyState = 3; }
  /** The server answered the upgrade with these headers; opens unless the bridge terminated. */
  respond(headers: UpgradeHeaders = {}) {
    this.emit("upgrade", { headers });
    if (!this.terminated) {
      this.readyState = 1;
      this.onopen?.();
    }
  }
  /** A genuine server: returns the valid counter-proof for the proof this dial presented. */
  respondGenuine(address = "127.0.0.1", port?: number) {
    const proof = parseProof(this.opts!.headers![LOCAL_PROOF_HEADER])!;
    const p = port ?? Number(new URL(this.url).port);
    const header = serverCounterProof({ token: TOKEN, binding: `${address}:${p}`, nonce: proof.nonce, mac: proof.mac });
    this.respond({ [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: header });
  }
}

const planFor =
  (over: Parameters<typeof localCredentialPlan>[1] = {}) =>
  (base: string) =>
    localCredentialPlan(base, {
      env: { homedir: home },
      marker: undefined,
      allowUnproven: undefined,
      connect: fakeConnect(),
      connectTls: fakeConnect(),
      log: () => {},
      ...over,
    });

function mk(url: string, over: Partial<ConstructorParameters<typeof ConnectionManager>[0]> = {}, planOver: Parameters<typeof localCredentialPlan>[1] = {}) {
  const reports: IdentityFailureReport[] = [];
  const onOpen = vi.fn();
  const cm = new ConnectionManager({
    url,
    WebSocketImpl: FakeWs as never,
    watchdogTimeout: 0,
    getSessionId: () => "sess-1",
    onIdentityFailure: (r) => reports.push(r),
    onOpen,
    planDial: planFor(planOver),
    ...over,
  });
  return { cm, reports, onOpen };
}
const flush = () => vi.advanceTimersByTimeAsync(0);
const last = () => FakeWs.instances.at(-1)!;
beforeEach(() => { FakeWs.instances = []; });

// ── BE21 ─────────────────────────────────────────────────────────────────────────────────

describe("BE21: a rogue loopback listener is refused", () => {
  const cases: Array<[string, (w: FakeWs) => void, string]> = [
    ["no counter-proof header", (w) => w.respond({}), "server_proof_missing"],
    ["invalid MAC", (w) => w.respond({ [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: `v1.${"x".repeat(43)}` }), "server_proof_invalid"],
    [
      "a proof minted for a different dial (expired / replayed)",
      (w) => {
        const header = serverCounterProof({ token: TOKEN, binding: "127.0.0.1:9999", nonce: "00".repeat(16), mac: "11".repeat(32) });
        w.respond({ [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: header });
      },
      "server_proof_invalid",
    ],
  ];
  for (const [label, answer, cause] of cases) {
    it(`${label}: no register frame, nothing dispatched, named cause ${cause}, backoff scheduled`, async () => {
      const { cm, reports, onOpen } = mk("ws://127.0.0.1:9999"); // marker unset: the spawn marker is NOT what triggers this
      cm.send({ type: "session_register", sessionId: "sess-1" });
      cm.connect();
      await flush();
      answer(last());
      expect(onOpen).not.toHaveBeenCalled();
      expect(last().sent).toEqual([]); // no register, no session data
      expect(last().terminated).toBe(true);
      expect(reports).toHaveLength(1);
      expect(proofFailureLogCause(reports[0].cause)).toBe(cause);
      const n = FakeWs.instances.length;
      await vi.advanceTimersByTimeAsync(5_000); // first quarantine step
      expect(FakeWs.instances.length).toBe(n + 1); // backoff re-dial, not a tight loop
    });
  }
});

// ── BE22 ─────────────────────────────────────────────────────────────────────────────────

describe("BE22: the decision — required iff token held and not opted out, whatever else is set", () => {
  const schemes = ["ws", "wss", "ws+unix"] as const;
  const hosts = ["127.0.0.1", "localhost", "[::1]"] as const;
  const markers: Array<string | undefined> = [undefined, "0", "1", "ws://127.0.0.1:9999"];
  const optOuts: Array<string | undefined> = [undefined, "1", "0", "true", ""];

  it("plan-level truth table (scheme × host × token × marker × opt-out)", async () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "r4-empty-"));
    for (const scheme of schemes) {
      for (const host of hosts) {
        if (scheme === "ws+unix" && host !== "127.0.0.1") continue;
        const endpoint = scheme === "ws+unix" ? "ws+unix:///tmp/gateway-9999.sock" : `${scheme}://${host}:9999`;
        for (const tokenHeld of [true, false]) {
          for (const marker of markers) {
            for (const optRaw of optOuts) {
              const label = `${endpoint} token=${tokenHeld} marker=${String(marker)} optout=${JSON.stringify(optRaw)}`;
              const logged: string[] = [];
              const plan = await localCredentialPlan(endpoint, {
                env: { homedir: tokenHeld ? home : emptyHome },
                marker,
                allowUnproven: optRaw,
                connect: fakeConnect(),
                connectTls: fakeConnect(),
                log: (l) => logged.push(l),
              });
              if (scheme === "ws+unix") {
                expect(plan, label).toBeUndefined(); // exempt: filesystem permissions
                continue;
              }
              const optedOut = optRaw === "1";
              if (tokenHeld) {
                expect(plan?.verifyUpgrade !== undefined, label).toBe(!optedOut);
                expect(plan?.headers?.[LOCAL_PROOF_HEADER], label).toBeTruthy(); // still presents its proof
                expect(logged.length, label).toBe(optedOut ? 1 : 0); // "skipping proof" once per dial
                if (optedOut) expect(logged[0]).toContain(ALLOW_UNPROVEN_LOCAL_SERVER_ENV);
              } else if (!markerEnforces(marker, endpoint)) {
                expect(plan, label).toBeUndefined(); // nothing to prove with, nothing demanded
              } else {
                // a MARKED dial with no token cannot verify anything: fails closed (pre-existing contract)
                expect(plan!.verifyUpgrade!({ headers: {} }), label).toMatchObject({ ok: false });
              }
            }
          }
        }
      }
    }
  });

  it("requiresServerProof is independent of the marker once a token is held", () => {
    for (const marker of markers) {
      expect(requiresServerProof({ endpoint: "ws://127.0.0.1:9999", tokenHeld: true, optOut: false, marker })).toBe(true);
      expect(requiresServerProof({ endpoint: "ws://127.0.0.1:9999", tokenHeld: true, optOut: true, marker })).toBe(false);
    }
    expect(requiresServerProof({ endpoint: "ws+unix:///x.sock", tokenHeld: true, optOut: false, marker: "ws://127.0.0.1:9999" })).toBe(false);
  });

  it("`0`, `true` and the empty string do NOT opt out; only exactly `1` does", async () => {
    for (const v of ["0", "true", ""]) {
      const plan = await planFor({ allowUnproven: v })("ws://127.0.0.1:9999");
      expect(plan!.verifyUpgrade, v).toBeTypeOf("function");
    }
    expect((await planFor({ allowUnproven: "1" })("ws://127.0.0.1:9999"))!.verifyUpgrade).toBeUndefined();
  });

  it("a wss loopback dial is bound to the TLS socket's address and verified", async () => {
    const tlsCalls: Array<{ host: string; port: number }> = [];
    const connectTls = async (host: string, port: number) => {
      tlsCalls.push({ host, port });
      return fakeConnect("127.0.0.1")(host, port);
    };
    const plan = await planFor({ connectTls })("wss://localhost:9443");
    expect(tlsCalls).toEqual([{ host: "localhost", port: 9443 }]);
    expect(plan!.verifyUpgrade).toBeTypeOf("function");
    expect(plan!.createConnection).toBeTypeOf("function");
    expect(plan!.verifyUpgrade!({ headers: {} })).toEqual({ ok: false, cause: "server-proof-missing" });
  });

  it("a remote host never gets a plan (the remote path authenticates with a ticket + pin)", async () => {
    expect(await planFor()("wss://remote.example:9443")).toBeUndefined();
    expect(await planFor()("ws://10.1.2.3:9999")).toBeUndefined();
  });
});

// ── BE23 / BX3 ───────────────────────────────────────────────────────────────────────────

describe("BE23: every dial site refuses an unproven server", () => {
  it("configured endpoint (localhost:8000) and auto-start spawned server: no register, named cause", async () => {
    for (const url of ["ws://localhost:8000", "ws://127.0.0.1:9999"]) {
      FakeWs.instances = [];
      const { cm, reports, onOpen } = mk(url);
      cm.send({ type: "session_register", sessionId: "s" });
      cm.connect();
      await flush();
      last().respond({});
      expect(onOpen, url).not.toHaveBeenCalled();
      expect(last().sent, url).toEqual([]);
      expect(reports[0].cause, url).toBe("server-proof-missing");
    }
  });

  it("reconnect after a drop: the redial is proven again (fresh nonce); an unproven answer is refused", async () => {
    const { cm, onOpen } = mk("ws://127.0.0.1:9999");
    cm.connect();
    await flush();
    last().respondGenuine();
    expect(onOpen).toHaveBeenCalledTimes(1);
    const firstNonce = parseProof(last().opts!.headers![LOCAL_PROOF_HEADER])!.nonce;
    last().readyState = 3;
    last().onclose?.();
    await vi.advanceTimersByTimeAsync(2_000);
    const redial = last();
    expect(parseProof(redial.opts!.headers![LOCAL_PROOF_HEADER])!.nonce).not.toBe(firstNonce);
    redial.respond({}); // the listener that replaced the real server cannot prove itself
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(redial.sent).toEqual([]);
  });

  it("cold-start retarget onto a discovered advert (no registered incumbent): refused on the dial", async () => {
    const { cm, reports, onOpen } = mk("ws://127.0.0.1:9999");
    cm.connect(); // the cold-start dial is in flight, not yet registered
    await flush();
    const accepted = await cm.retargetTo("ws://127.0.0.1:9594", { trigger: "mdns" });
    expect(accepted).toBe(true); // nothing established to protect
    await flush();
    expect(last().url).toBe("ws://127.0.0.1:9594");
    last().respond({});
    expect(onOpen).not.toHaveBeenCalled();
    expect(reports[0].cause).toBe("server-proof-missing");
  });

  it("a genuine server with a valid proof is adopted at every site, marker unset AND `0`", async () => {
    for (const marker of [undefined, "0"]) {
      for (const url of ["ws://localhost:8000", "ws://127.0.0.1:9999", "wss://localhost:9443"]) {
        FakeWs.instances = [];
        const { cm, onOpen } = mk(url, {}, { marker });
        cm.connect();
        await flush();
        last().respondGenuine("127.0.0.1", Number(new URL(url).port));
        expect(onOpen, `${url} marker=${String(marker)}`).toHaveBeenCalledTimes(1);
      }
    }
  });
});

describe("BX3: a server that predates counter-proof", () => {
  it("unset → refused with a named cause, session data never sent", async () => {
    const { cm, reports, onOpen } = mk("ws://127.0.0.1:9999");
    cm.send({ type: "session_register", sessionId: "s" });
    cm.connect();
    await flush();
    last().respond({});
    expect(onOpen).not.toHaveBeenCalled();
    expect(last().sent).toEqual([]);
    expect(reports[0].cause).toBe("server-proof-missing");
  });

  it("`1` → connects without proof and logs that proof is skipped once per dial, not per frame", async () => {
    const logged: string[] = [];
    const { cm, onOpen } = mk("ws://127.0.0.1:9999", {}, { allowUnproven: "1", log: (l) => logged.push(l) });
    cm.send({ type: "session_register", sessionId: "s" });
    cm.connect();
    await flush();
    last().respond({});
    expect(onOpen).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) cm.send({ type: "session_heartbeat", sessionId: "s" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("skipping server counter-proof");
  });
});

// ── BE24 / BX2 ───────────────────────────────────────────────────────────────────────────

/** The probe's own socket stand-in: records what the probe does, emits what the candidate would. */
class ProbeWs {
  static last?: ProbeWs;
  terminated = false;
  sent: string[] = [];
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  url: string;
  opts: { headers?: Record<string, string> };
  constructor(url: string, opts: { headers?: Record<string, string> }) { this.url = url; this.opts = opts; ProbeWs.last = this; }
  on(ev: string, fn: (...a: unknown[]) => void) { this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]); }
  emit(ev: string, ...a: unknown[]) { for (const fn of this.handlers.get(ev) ?? []) fn(...a); }
  send(d: string) { this.sent.push(d); }
  terminate() { this.terminated = true; }
}

describe("BE24: the guarded migration needs identity, not just health", () => {
  const healthy = async () => true;

  async function registeredOn(url: string) {
    const events: Array<{ accepted: boolean; reason: string }> = [];
    const { cm } = mk(url, { onMigrationEvent: (r) => events.push(r) });
    cm.connect();
    await flush();
    last().respondGenuine("127.0.0.1", Number(new URL(url).port));
    cm.noteRegistered();
    return { cm, events };
  }
  const candidateUrl = "ws://127.0.0.1:9594";
  const verify = (probeOver: Partial<Parameters<typeof verifyDiscoveredCandidate>[0]["probe"]> = {}, log: (l: string) => void = () => {}) => () =>
    verifyDiscoveredCandidate({
      healthUrl: "http://127.0.0.1:9594/api/health",
      candidateUrl,
      reachable: healthy,
      probe: { plan: planFor(), WebSocketImpl: ProbeWs as never, ...probeOver },
      log,
    });

  it("healthy candidate with NO counter-proof: the established connection is kept, cause logged", async () => {
    const { cm, events } = await registeredOn("ws://localhost:9999");
    const logs: string[] = [];
    const before = FakeWs.instances.length;
    const pending = cm.retargetTo(candidateUrl, { trigger: "mdns", verify: verify({}, (l) => logs.push(l)) });
    await flush();
    ProbeWs.last!.emit("upgrade", { headers: {} });
    expect(await pending).toBe(false);
    expect(cm.isConnected).toBe(true);
    expect(FakeWs.instances.length).toBe(before); // never re-targeted: no new dial
    expect(ProbeWs.last!.terminated).toBe(true);
    expect(ProbeWs.last!.sent).toEqual([]); // the probe never sends a frame
    expect(logs.join("\n")).toContain("server_proof_missing");
    expect(events.at(-1)).toMatchObject({ accepted: false });
  });

  it("a wrong MAC is `server_proof_invalid`", async () => {
    const { cm } = await registeredOn("ws://localhost:9999");
    const logs: string[] = [];
    const pending = cm.retargetTo(candidateUrl, { trigger: "mdns", verify: verify({}, (l) => logs.push(l)) });
    await flush();
    ProbeWs.last!.emit("upgrade", { headers: { [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: `v1.${"y".repeat(43)}` } });
    expect(await pending).toBe(false);
    expect(logs.join("\n")).toContain("server_proof_invalid");
  });

  it("a loopback wss:// candidate with a valid certificate but no proof is refused too", async () => {
    const { cm } = await registeredOn("ws://localhost:9999");
    const tlsHosts: string[] = [];
    const connectTls = async (h: string, p: number) => { tlsHosts.push(`${h}:${p}`); return fakeConnect()(h, p); };
    const pending = cm.retargetTo("wss://127.0.0.1:9443", {
      trigger: "mdns",
      verify: () =>
        verifyDiscoveredCandidate({
          healthUrl: "https://127.0.0.1:9443/api/health",
          candidateUrl: "wss://127.0.0.1:9443",
          reachable: healthy,
          probe: { plan: planFor({ connectTls }), WebSocketImpl: ProbeWs as never },
          log: () => {},
        }),
    });
    await flush();
    ProbeWs.last!.emit("upgrade", { headers: {} });
    expect(await pending).toBe(false);
    expect(tlsHosts).toEqual(["127.0.0.1:9443"]);
  });

  it("with a valid proof the migration is allowed", async () => {
    const { cm, events } = await registeredOn("ws://localhost:9999");
    const pending = cm.retargetTo(candidateUrl, { trigger: "mdns", verify: verify() });
    await flush();
    const probe = ProbeWs.last!;
    const nonce = parseProof(probe.opts.headers![LOCAL_PROOF_HEADER])!;
    probe.emit("upgrade", {
      headers: { [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: serverCounterProof({ token: TOKEN, binding: "127.0.0.1:9594", nonce: nonce.nonce, mac: nonce.mac }) },
    });
    expect(await pending).toBe(true);
    expect(events.at(-1)).toMatchObject({ accepted: true });
    expect(probe.terminated).toBe(true);
  });

  it("an unreachable candidate never reaches the proof probe", async () => {
    const probeSpy = vi.fn();
    const ok = await verifyDiscoveredCandidate({
      healthUrl: "http://x/api/health",
      candidateUrl,
      reachable: async () => false,
      probe: { plan: async () => { probeSpy(); return undefined; } },
    });
    expect(ok).toBe(false);
    expect(probeSpy).not.toHaveBeenCalled();
  });

  it("BX2: a counter-proof response that stalls past the probe timeout is refused as invalid; incumbent retained", async () => {
    const { cm } = await registeredOn("ws://localhost:9999");
    const logs: string[] = [];
    const pending = cm.retargetTo(candidateUrl, { trigger: "mdns", verify: verify({ timeoutMs: 1_000 }, (l) => logs.push(l)) });
    await flush();
    await vi.advanceTimersByTimeAsync(1_000); // the candidate never answers the upgrade
    expect(await pending).toBe(false);
    expect(cm.isConnected).toBe(true);
    expect(ProbeWs.last!.terminated).toBe(true);
    expect(logs.join("\n")).toContain("server_proof_invalid");
  });

  it("nothing to prove (no token / remote / opt-out) is ok without opening a probe socket", async () => {
    ProbeWs.last = undefined;
    expect(await probeServerProof("ws://10.1.2.3:9999", { plan: planFor(), WebSocketImpl: ProbeWs as never })).toEqual({ ok: true });
    expect(await probeServerProof(candidateUrl, { plan: planFor({ allowUnproven: "1" }), WebSocketImpl: ProbeWs as never })).toEqual({ ok: true });
    expect(ProbeWs.last).toBeUndefined();
  });
});

// ── BX1 ──────────────────────────────────────────────────────────────────────────────────

describe("BX1: every candidate fails proof", () => {
  it("3 discovery cycles: stays disconnected, never registers, backoff keeps growing, searching continues", async () => {
    const { cm, reports, onOpen } = mk("ws://127.0.0.1:9999");
    cm.send({ type: "session_register", sessionId: "s" });
    cm.connect();
    await flush();
    const answers: Array<(w: FakeWs) => void> = [
      (w) => w.respond({}),
      (w) => w.respond({ [LOCAL_PROOF_SERVER_HEADER.toLowerCase()]: `v1.${"z".repeat(43)}` }),
      (w) => w.respond({}),
    ];
    const delays = [5_000, 30_000, 60_000];
    for (let i = 0; i < 3; i++) {
      const n = FakeWs.instances.length;
      answers[i](last());
      expect(last().sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(delays[i] - 1);
      expect(FakeWs.instances.length).toBe(n); // not before the (growing) backoff
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWs.instances.length).toBe(n + 1); // the loop keeps searching
    }
    expect(onOpen).not.toHaveBeenCalled();
    expect(reports.length).toBeGreaterThanOrEqual(2);
  });
});
