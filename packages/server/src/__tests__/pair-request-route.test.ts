/**
 * `POST /api/pair/request` — the LAN knock route (L1).
 * test-plan #E19 #E20 #E21 #X1 #X2 of change add-lan-knock-pairing.
 * Exemplar: pairing-approval-dialog.test.ts (route + guard glue).
 *
 * Driven through the REAL network-guard hook, the REAL mutation-origin gate and
 * the REAL route registration, so "never network_not_allowed" and "foreign
 * Origin is refused first" are observed rather than assumed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkGuard, createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createMutationOriginGate } from "../auth/mutation-origin-gate.js";
import { createRefusalLogger } from "../pairing/knock-admission.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { PUBLIC_PAIRING_PREFIXES, registerPairingRoutes } from "../routes/pairing-routes.js";
import { stampLegacyHook } from "../test-support/local-credential-stamp.js";

const LOCAL_TOKEN = "local-token-for-knock";
const SERVER = "192.168.16.204:8000";
const IFACES = [{ address: "192.168.16.204", netmask: "255.255.255.0" }];

let tmpDir: string;
const apps: FastifyInstance[] = [];
const managers: PairingManager[] = [];

async function mkApp(opts: { accept?: boolean; refusalLog?: ReturnType<typeof createRefusalLogger> } = {}) {
  const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  const mgr = new PairingManager({
    registry: reg,
    getFingerprint: () => "sha256:test-fp",
    getReachableUrls: () => [],
  });
  managers.push(mgr);
  const app = Fastify();
  apps.push(app);
  stampLegacyHook(app, LOCAL_TOKEN);
  const state = { accept: opts.accept ?? true };
  app.addHook("onRequest", createMutationOriginGate(() => ({ configuredOrigins: [], trustedNetworks: [] })));
  app.addHook(
    "onRequest",
    createNetworkGuardHook({
      trustedNetworks: [], // the knocking peer is NOT trusted and holds no credential
      localToken: LOCAL_TOKEN,
      getPairingPrefixes: () => PUBLIC_PAIRING_PREFIXES,
      logDenial: () => {},
    }),
  );
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-session"] === "1") (req as unknown as { authVia: string }).authVia = "session";
  });
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([]),
    identity: { fingerprint: "sha256:test-fp" } as never,
    pairing: mgr,
    registry: reg,
    localToken: LOCAL_TOKEN,
    hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], bindHost: "192.168.16.204" }),
    getAcceptLanRequests: () => state.accept,
    getLanInterfaces: () => IFACES,
    ...(opts.refusalLog ? { logKnockRefusal: opts.refusalLog } : {}),
  });
  await app.ready();
  return { app, mgr, reg, state };
}

const knock = (
  app: FastifyInstance,
  over: { peer?: string; headers?: Record<string, string>; payload?: unknown; contentType?: string } = {},
) =>
  app.inject({
    method: "POST",
    url: "/api/pair/request",
    remoteAddress: over.peer ?? "192.168.16.31",
    headers: { host: SERVER, "content-type": over.contentType ?? "application/json", ...over.headers },
    payload: (over.payload ?? { name: "Roberts-MacBook-Pro" }) as never,
  });

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-knock-route-"));
});

afterEach(async () => {
  for (const m of managers.splice(0)) m.dispose();
  for (const a of apps.splice(0)) await a.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("#E19 admitted knock", () => {
  it("returns {pendingId, confirmCode, expiresAt, fingerprint} to an untrusted, credential-less LAN peer", async () => {
    const { app, mgr } = await mkApp();
    const res = await knock(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.error).not.toBe("network_not_allowed");
    expect(body.success).toBe(true);
    expect(body.data.confirmCode).toMatch(/^\d{8}$/);
    expect(body.data.fingerprint).toBe("sha256:test-fp");
    expect(typeof body.data.expiresAt).toBe("number");
    expect(body.data.expiresAt).toBeGreaterThan(Date.now() + 290_000);
    const [pending] = mgr.listPending();
    expect(pending).toMatchObject({
      provenance: "knock",
      remoteAddress: "192.168.16.31",
      unencrypted: true,
      requesterName: "Roberts-MacBook-Pro",
    });
  });

  it("completes through the existing approve → poll path", async () => {
    const { app, mgr } = await mkApp();
    const { data } = (await knock(app)).json();
    const approve = await app.inject({
      method: "POST",
      url: "/api/pair/approve-pending",
      remoteAddress: "127.0.0.1",
      headers: { "content-type": "application/json", "x-test-session": "1", host: "localhost:8000" },
      payload: { pendingId: data.pendingId, confirmCode: data.confirmCode },
    });
    expect(approve.statusCode).toBe(200);
    expect(mgr.poll(data.pendingId).status).toBe("approved");
  });

  it("refuses with the distinct error codes", async () => {
    const off = await mkApp({ accept: false });
    expect((await knock(off.app)).json()).toMatchObject({ success: false, error: "knock_disabled" });
    expect((await knock(off.app, { peer: "203.0.113.9" })).json()).toMatchObject({ error: "knock_not_lan" });
    expect((await knock(off.app, { headers: { "x-forwarded-for": "203.0.113.9" } })).json()).toMatchObject({
      error: "knock_not_lan",
    });
    expect((await knock(off.app, { headers: { host: "evil.test" } })).json()).toMatchObject({ error: "host_not_admitted" });
    expect(off.mgr.listPending()).toHaveLength(0);
  });

  it("a second knock from the same source is 409 knock_pending", async () => {
    const { app } = await mkApp();
    await knock(app);
    const res = await knock(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("knock_pending");
  });

  it("a denied knock imposes a cooldown through the manager callback", async () => {
    const { app, mgr } = await mkApp();
    const { data } = (await knock(app)).json();
    mgr.deny(data.pendingId);
    const res = await knock(app);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: "knock_rate_limited" });
    expect(res.json().retryAfter).toBeGreaterThan(0);
  });

  it("switching the toggle off keeps a live knock approvable", async () => {
    const { app, mgr, state } = await mkApp();
    const { data } = (await knock(app)).json();
    state.accept = false;
    expect((await knock(app, { peer: "192.168.16.32" })).json().error).toBe("knock_disabled");
    expect(mgr.approvePending(data.pendingId, data.confirmCode).ok).toBe(true);
  });
});

describe("#E20 route preconditions", () => {
  it("a foreign Origin is refused by the mutation-origin gate before any gate; nothing is raised", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { app, mgr } = await mkApp();
    let hints = 0;
    mgr.onPendingChanged(() => hints++);
    const res = await knock(app, { headers: { origin: "https://evil.example" } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "untrusted origin" });
    expect(mgr.listPending()).toHaveLength(0);
    expect(hints).toBe(0);
  });

  it("a non-JSON body is 415 and raises nothing", async () => {
    const { app, mgr } = await mkApp();
    const res = await knock(app, { contentType: "text/plain", payload: "name=x" });
    expect(res.statusCode).toBe(415);
    expect(mgr.listPending()).toHaveLength(0);
  });

  it("an absent body (no name) still knocks", async () => {
    const { app, mgr } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/request",
      remoteAddress: "192.168.16.31",
      headers: { host: SERVER },
    });
    expect(res.statusCode).toBe(200);
    expect(mgr.listPending()[0].requesterName).toBeUndefined();
  });
});

describe("#E21 approve-pending tier", () => {
  async function approve(tier: unknown, extra: Record<string, unknown> = {}) {
    const { app, mgr, reg } = await mkApp();
    const { data } = (await knock(app)).json();
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/approve-pending",
      remoteAddress: "127.0.0.1",
      headers: { "content-type": "application/json", "x-test-session": "1", host: "localhost:8000" },
      payload: { pendingId: data.pendingId, confirmCode: data.confirmCode, ...(tier === undefined ? {} : { tier }), ...extra },
    });
    return { res, mgr, reg, data };
  }
  it("tier observe is applied", async () => {
    const { res, reg } = await approve("observe");
    expect(res.statusCode).toBe(200);
    expect(reg.list()[0].tier).toBe("observe");
  });
  it.each([["admin"], [123]])("invalid tier %s → 400 and the knock stays pending", async (tier) => {
    const { res, mgr, reg } = await approve(tier);
    expect(res.statusCode).toBe(400);
    expect(mgr.listPending()).toHaveLength(1);
    expect(mgr.listPending()[0].attemptsLeft).toBe(5);
    expect(reg.list()).toHaveLength(0);
  });
  it("absent tier keeps the pairing default (operate)", async () => {
    const { res, reg } = await approve(undefined);
    expect(res.statusCode).toBe(200);
    expect(reg.list()[0].tier).toBe("operate");
  });
});

describe("#X1 admission log redaction", () => {
  it("logs one `knock admitted id=<8>` line with no code, name, address or UA", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const { app } = await mkApp();
    const res = await knock(app, { headers: { "user-agent": "SecretAgent/9.9" }, payload: { name: "Roberts-MacBook-Pro" } });
    const { data } = res.json();
    const admitted = lines.filter((l) => l.includes("knock admitted"));
    expect(admitted).toHaveLength(1);
    expect(admitted[0]).toBe(`[pairing] knock admitted id=${data.pendingId.slice(0, 8)}`);
    const all = lines.join("\n");
    for (const secret of [data.confirmCode, "Roberts-MacBook-Pro", "192.168.16.31", "SecretAgent"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("#X2 refusal throttle and flush", () => {
  it("100 refusals in a window log one line, then a suppressed=99 flush with no further traffic", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const lines: string[] = [];
    const refusalLog = createRefusalLogger((l) => lines.push(l));
    const { app } = await mkApp({ accept: false, refusalLog });
    for (let i = 0; i < 100; i++) await knock(app);
    expect(lines.filter((l) => l.includes("knock_disabled"))).toEqual(["[pairing] knock refused reason=knock_disabled"]);
    vi.advanceTimersByTime(60_000);
    expect(lines).toContain("[pairing] knock refused reason=knock_disabled suppressed=99");
    expect(lines).toHaveLength(2);
  });

  it("reasons throttle independently and lines carry no address", async () => {
    const lines: string[] = [];
    const refusalLog = createRefusalLogger((l) => lines.push(l));
    const { app } = await mkApp({ accept: false, refusalLog });
    await knock(app); // knock_disabled
    await knock(app, { peer: "203.0.113.9" }); // knock_not_lan
    await knock(app);
    expect(lines).toEqual([
      "[pairing] knock refused reason=knock_disabled",
      "[pairing] knock refused reason=knock_not_lan",
    ]);
    expect(lines.join("")).not.toContain("203.0.113.9");
  });
});
