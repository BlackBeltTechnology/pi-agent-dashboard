/**
 * requireLocalProof (strict local proof) + pairing approval without bare loopback.
 * See change: harden-trust-and-credential-boundaries (D2/D6;
 * T-E5..E14, E15, E17..E20, X5..X8, D0 X8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideBridgeTicketMint } from "../auth/bridge-ticket-eligibility.js";
import {
  createLocalTrustContext,
  LOCAL_PROOF_COOKIE,
  LocalProofCodeStore,
  signLocalProof,
  verifyLocalProofCookie,
} from "../auth/local-proof.js";
import {
  createNetworkGuard,
  createNetworkGuardHook,
  isLocallyTrusted,
  isPluginScopePeerLocal,
  isTrustedSource,
} from "../auth/localhost-guard.js";
import { createRouteTierGate, tierRefusalFor } from "../auth/route-tier-gate.js";
import { authorizeWsUpgrade, validateWsUpgrade } from "../auth/auth-plugin.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { registerLocalProofRoutes } from "../routes/local-proof-routes.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";

const TOKEN = "local-token-xyz";
let strict = false;
const ctx = createLocalTrustContext(TOKEN, () => strict);
const LOOP = "127.0.0.1";
const hdr = (extra: Record<string, string> = {}) => ({ host: "localhost:8000", ...extra });
const proofCookie = () => `${LOCAL_PROOF_COOKIE}=${signLocalProof(ctx)}`;

beforeEach(() => {
  strict = false;
});

describe("isLocallyTrusted / hasLocalProof decision table (E5)", () => {
  const cases: Array<[string, Record<string, string>, boolean]> = [
    ["bare", {}, false],
    ["proof cookie", { cookie: "" }, true],
    ["local token", { "x-pi-local-token": TOKEN }, true],
    ["forged cookie", { cookie: `${LOCAL_PROOF_COOKIE}=a.${Date.now() + 1e6}.AAAA` }, false],
    ["expired cookie", { cookie: `${LOCAL_PROOF_COOKIE}=${signLocalProof(ctx, Date.now() - 10_000_000, 1)}` }, false],
    ["old-key cookie", { cookie: `${LOCAL_PROOF_COOKIE}=${signLocalProof(createLocalTrustContext("old-token", () => true))}` }, false],
  ];
  for (const [name, h, wantOn] of cases) {
    it(`${name}: strict off → admitted; strict on → ${wantOn}`, () => {
      const headers = { ...h, ...(name === "proof cookie" ? { cookie: proofCookie() } : {}) };
      strict = false;
      expect(isLocallyTrusted({ ip: LOOP, headers }, ctx)).toBe(true);
      strict = true;
      expect(isLocallyTrusted({ ip: LOOP, headers }, ctx)).toBe(wantOn);
    });
  }
  it("a forwarding header is never locally trusted", () => {
    expect(isLocallyTrusted({ ip: LOOP, headers: { "x-forwarded-for": "1.2.3.4", "x-pi-local-token": TOKEN } }, ctx)).toBe(false);
  });
  it("verifyLocalProofCookie rejects garbage", () => {
    expect(verifyLocalProofCookie("nope", ctx)).toBe(false);
    expect(verifyLocalProofCookie(undefined, ctx)).toBe(false);
  });
});

describe("trusted-network loopback entry (E9)", () => {
  it("a 127.0.0.1 entry cannot re-admit a relay under strict", () => {
    strict = false;
    expect(isTrustedSource(LOOP, {}, ["127.0.0.1"], ctx)).toBe(true);
    strict = true;
    expect(isTrustedSource(LOOP, {}, ["127.0.0.1"], ctx)).toBe(false);
    expect(isTrustedSource(LOOP, { "x-pi-local-token": TOKEN }, ["127.0.0.1"], ctx)).toBe(true);
    expect(isTrustedSource("10.0.0.5", {}, ["10.0.0.0/8"], ctx)).toBe(true);
  });
});

async function guardedApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(fastifyCookie);
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [], localToken: TOKEN, localTrust: ctx }));
  app.get("/api/sessions", async () => ({ ok: true }));
  app.post("/api/restart", async () => ({ ok: true }));
  app.get("/api/health", async () => ({ ok: true, accessGrants: true }));
  await app.ready();
  return app;
}

describe("HTTP admission through the universal guard (E5, E6, E13, E17)", () => {
  let app: FastifyInstance;
  beforeEach(async () => (app = await guardedApp()));
  afterEach(async () => app.close());
  const req = (method: "GET" | "POST", url: string, headers: Record<string, string> = {}) =>
    app.inject({ method, url, remoteAddress: LOOP, headers });

  it("strict off: bare loopback admitted on operate", async () => {
    expect((await req("POST", "/api/restart")).statusCode).toBe(200);
  });
  it("strict on: bare → 403 local_proof_required with hint; cookie/token admitted", async () => {
    strict = true;
    const r = await req("POST", "/api/restart");
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("local_proof_required");
    expect(r.json().hint).toContain("pi-dashboard open");
    expect((await req("POST", "/api/restart", { cookie: proofCookie() })).statusCode).toBe(200);
    expect((await req("POST", "/api/restart", { "x-pi-local-token": TOKEN })).statusCode).toBe(200);
  });
  it("strict on: forged cookie denied", async () => {
    strict = true;
    expect((await req("POST", "/api/restart", { cookie: `${LOCAL_PROOF_COOKIE}=x.1.y` })).statusCode).toBe(403);
  });
  it("E6 observe exception: GET observe 200, operate 403, unmatched 403", async () => {
    strict = true;
    // /api/sessions is `observe`? Use the route table to be sure.
    const { routeTier } = await import("@blackbelt-technology/pi-dashboard-shared/route-tiers.js");
    const observeRoute = routeTier("GET", "/api/sessions") === "observe";
    expect((await req("GET", "/api/sessions")).statusCode).toBe(observeRoute ? 200 : 403);
    expect((await req("POST", "/api/restart")).statusCode).toBe(403);
    expect((await req("GET", "/api/nope")).statusCode).toBe(403);
  });
  it("E17 live toggle: no restart needed", async () => {
    expect((await req("POST", "/api/restart")).statusCode).toBe(200);
    strict = true;
    expect((await req("POST", "/api/restart")).statusCode).toBe(403);
  });
  it("E13 /api/health stays public under strict", async () => {
    strict = true;
    expect((await req("GET", "/api/health")).statusCode).toBe(200);
  });
});

describe("WebSocket scopes (E7, E8)", () => {
  for (const scope of ["browser", "terminal", "live"] as const) {
    it(`${scope}: strict gates validateWsUpgrade + authorizeWsUpgrade`, () => {
      const run = (headers: Record<string, unknown>) => ({
        v: validateWsUpgrade(undefined, LOOP, "s", [], { headers, localTrust: ctx }),
        a: authorizeWsUpgrade({ remoteAddress: LOOP, headers, scope: scope as never, localTrust: ctx }).ok,
      });
      strict = false;
      expect(run({})).toEqual({ v: true, a: true });
      strict = true;
      expect(run({})).toEqual({ v: false, a: false });
      expect(run({ cookie: proofCookie() })).toEqual({ v: true, a: true });
    });
  }
  it("E8 plugin-scope peer", () => {
    strict = true;
    expect(isPluginScopePeerLocal(LOOP, "localhost:8000", {}, ctx)).toBe(false);
    expect(isPluginScopePeerLocal(LOOP, "localhost:8000", { cookie: proofCookie() }, ctx)).toBe(true);
    strict = false;
    expect(isPluginScopePeerLocal(LOOP, "localhost:8000", {}, ctx)).toBe(true);
  });
});

describe("tier exemption + bridge mint (E10, E11)", () => {
  it("E10 tierRefusalFor", () => {
    const base = { ip: LOOP, authVia: "device", principalTier: "observe", headers: {} as Record<string, unknown> };
    const r = (h: Record<string, unknown> = {}) => tierRefusalFor({ ...base, headers: h } as never, "operate", () => [], ctx);
    strict = false;
    expect(r()).toBeNull();
    strict = true;
    expect(r()).toMatchObject({ scope: "operate" });
    expect(r({ cookie: proofCookie() })).toBeNull();
  });
  it("E11 decideBridgeTicketMint", () => {
    const d = (headers: Record<string, unknown>) =>
      decideBridgeTicketMint({ ip: LOOP, headers, localTrust: ctx, verifyDeviceBearer: () => null }).allow;
    strict = false;
    expect(d({})).toBe(true);
    strict = true;
    expect(d({})).toBe(false);
    expect(d({ "x-pi-local-token": TOKEN })).toBe(true);
  });
});

describe("local-proof bootstrap (E15, X5, X6, X7)", () => {
  let app: FastifyInstance;
  let clock: number;
  beforeEach(async () => {
    clock = 1_000_000;
    app = Fastify();
    await app.register(fastifyCookie);
    registerLocalProofRoutes(app, { codes: new LocalProofCodeStore(() => clock), ctx });
    await app.ready();
  });
  afterEach(async () => app.close());
  const mint = async () =>
    (await app.inject({ method: "POST", url: "/api/local-proof", headers: { "x-pi-local-token": TOKEN } })).json().data.code as string;
  const redeem = (code: string) => app.inject({ method: "GET", url: `/auth/local-proof?code=${code}` });
  const proofSet = (res: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat((res.headers["set-cookie"] as string[] | string | undefined) ?? []).find((c) => c.startsWith("pi_dash_local="));

  it("X5 mint requires the local token", async () => {
    expect((await app.inject({ method: "POST", url: "/api/local-proof" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/local-proof", headers: { "x-pi-local-token": "wrong" } })).statusCode).toBe(401);
  });
  it("E15 TTL: 59 s ok with cookie attrs, 61 s no cookie; X6 single use; X7 works with strict off", async () => {
    const ok = await redeem(await mint());
    clock += 59_000;
    expect(ok.statusCode).toBe(302);
    const c = proofSet(ok)!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=2592000/);
    // X6: reuse of a redeemed code
    const code = await mint();
    await redeem(code);
    expect(proofSet(await redeem(code))).toBeUndefined();
    // 59 s vs 61 s
    const c59 = await mint();
    clock += 59_000;
    expect(proofSet(await redeem(c59))).toBeDefined();
    const c61 = await mint();
    clock += 61_000;
    expect(proofSet(await redeem(c61))).toBeUndefined();
    // cookie value verifies
    expect(verifyLocalProofCookie(c.split(";")[0]!.split("=")[1], ctx)).toBe(true);
  });
});

describe("pairing approval never honors bare loopback (E19, E20)", () => {
  let tmp: string;
  let app: FastifyInstance;
  let mgr: PairingManager;
  let reg: PairedDeviceRegistry;
  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lp-"));
    reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
    mgr = new PairingManager({ registry: reg, getFingerprint: () => "sha256:test-fp", getReachableUrls: () => ["https://a.example"], now: () => 1_000_000 });
    app = Fastify();
    await app.register(fastifyCookie);
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", async (r) => {
      if (r.headers["x-test-session"] === "1") (r as any).authVia = "session";
    });
    registerBearerAuth(app, { registry: reg });
    registerPairingRoutes(app, {
      networkGuard: createNetworkGuard([]),
      identity: {} as never,
      pairing: mgr,
      registry: reg,
      localToken: TOKEN,
      localTrust: ctx,
      hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], getLiveTunnelOrigins: () => [], bindHost: "localhost" }),
    });
    await app.ready();
  });
  afterEach(async () => {
    mgr.dispose();
    await app.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const pend = () => {
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code);
    if (!r.ok) throw new Error("redeem");
    return { code: p.code, pendingId: r.pendingId, confirmCode: r.confirmCode };
  };
  const post = (url: string, payload: unknown, headers: Record<string, string> = {}, ip = LOOP) =>
    app.inject({ method: "POST", url, remoteAddress: ip, headers: { "content-type": "application/json", host: "localhost:8000", ...headers }, payload: payload as never });

  for (const route of ["approve", "approve-pending"] as const) {
    const body = (d: ReturnType<typeof pend>) => (route === "approve" ? { code: d.code, confirmCode: d.confirmCode } : { pendingId: d.pendingId, confirmCode: d.confirmCode });
    it(`${route}: bare loopback → 401, pending stays; session/cookie/token approve`, async () => {
      for (const strictMode of [false, true]) {
        strict = strictMode;
        const d = pend();
        expect((await post(`/api/pair/${route}`, body(d))).statusCode).toBe(401);
        expect(mgr.poll(d.pendingId)).toEqual({ status: "pending" });
        expect((await post(`/api/pair/${route}`, body(d), { cookie: proofCookie() })).statusCode).toBe(200);
        const d2 = pend();
        expect((await post(`/api/pair/${route}`, body(d2), { "x-pi-local-token": TOKEN })).statusCode).toBe(200);
        const d3 = pend();
        expect((await post(`/api/pair/${route}`, body(d3), { "x-test-session": "1" }, "203.0.113.9")).statusCode).toBe(200);
      }
    });
    it(`${route}: device bearer from loopback → 401`, async () => {
      const phone = reg.add("phone");
      const d = pend();
      expect((await post(`/api/pair/${route}`, body(d), { authorization: `Bearer ${phone.token}`, "x-pi-local-token": TOKEN })).statusCode).toBe(401);
    });
    it(`${route}: valid token but non-admitted Host → 403 host_not_admitted (E20)`, async () => {
      const d = pend();
      const res = await post(`/api/pair/${route}`, body(d), { "x-pi-local-token": TOKEN, host: "evil.example" });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("host_not_admitted");
    });
  }

  it("E12 operator routes follow D2: bare admitted off, 401 on", async () => {
    const get = () => app.inject({ method: "GET", url: "/api/pair/pending", remoteAddress: LOOP, headers: { host: "localhost:8000" } });
    strict = false;
    expect((await get()).statusCode).toBe(200);
    strict = true;
    expect((await get()).statusCode).toBe(401);
  });
});

describe("D0: cookie parsing without OAuth providers (X8)", () => {
  it("a server-level cookie plugin exposes request.cookies", async () => {
    const app = Fastify();
    await app.register(fastifyCookie);
    app.get("/x", async (r) => ({ c: (r.cookies as Record<string, string>).a }));
    const res = await app.inject({ method: "GET", url: "/x", headers: { cookie: "a=1" } });
    expect(res.json().c).toBe("1");
    await app.close();
  });
});

void createRouteTierGate;
void vi;
