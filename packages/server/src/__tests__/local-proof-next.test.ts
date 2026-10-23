/**
 * `GET /auth/local-proof?next=` — same-origin redirect after redeeming a local-proof code.
 * Exemplar: local-proof-strict.test.ts ("local-proof bootstrap").
 * See change: fix-pairing-approval-credential (test-plan E24–E28).
 */
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalTrustContext,
  inspectLocalProofCookie,
  LOCAL_PROOF_COOKIE,
  LocalProofCodeStore,
  signLocalProof,
  verifyLocalProofCookie,
} from "../auth/local-proof.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { registerLocalProofRoutes } from "../routes/local-proof-routes.js";
import { stampLegacyHook } from "../test-support/local-credential-stamp.js";

const TOKEN = "local-token-next";
const ctx = createLocalTrustContext(TOKEN, () => false);

let app: FastifyInstance;
let clock: number;

beforeEach(async () => {
  clock = 1_000_000;
  app = Fastify();
  stampLegacyHook(app, TOKEN);
  await app.register(fastifyCookie);
  registerLocalProofRoutes(app, { codes: new LocalProofCodeStore(() => clock), ctx });
  await app.ready();
});
afterEach(async () => app.close());

const mint = async () =>
  (await app.inject({ method: "POST", url: "/api/local-proof", headers: { "x-pi-local-token": TOKEN } })).json().data
    .code as string;
const redeem = (code: string, query = "") =>
  app.inject({ method: "GET", url: `/auth/local-proof?code=${code}${query}` });
const proofCookies = (res: { headers: Record<string, unknown> }) =>
  ([] as string[]).concat((res.headers["set-cookie"] as string[] | string | undefined) ?? []).filter((c) =>
    c.startsWith("pi_dash_local="),
  );

describe("E24 — next= honoured", () => {
  it("sets the httpOnly SameSite=Strict proof cookie and redirects to the same-origin path", async () => {
    const res = await redeem(await mint(), "&next=/settings/gateway");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/settings/gateway");
    const [cookie] = proofCookies(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });
  it("no next → /", async () => {
    expect((await redeem(await mint())).headers.location).toBe("/");
  });
});

describe("E25 — hostile next= collapses to /", () => {
  it.each([
    ["CRLF header injection", "%0D%0ASet-Cookie:%20x=y"],
    ["TAB protocol-relative", "%09/evil.example"],
    ["//evil", "%2F%2Fevil.example"],
    ["absolute URL", "https%3A%2F%2Fevil.example%2F"],
  ])("%s", async (_n, next) => {
    const res = await redeem(await mint(), `&next=${next}`);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(proofCookies(res)).toHaveLength(1);
    for (const [k, v] of Object.entries(res.headers)) {
      for (const one of ([] as unknown[]).concat(v)) expect(`${k}:${String(one)}`).not.toMatch(/[\r\n]/);
    }
    expect(([] as string[]).concat(res.headers["set-cookie"] as string[])).toHaveLength(1);
  });
});

describe("E28 — duplicate next", () => {
  it("?next=/ok&next=//evil (array) → /", async () => {
    const res = await redeem(await mint(), "&next=/ok&next=//evil");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    expect(proofCookies(res)).toHaveLength(1);
  });
});

describe("E26 — a spent code grants nothing, whatever next says", () => {
  it("second redemption: 403, no Set-Cookie, no redirect to /settings", async () => {
    const code = await mint();
    expect((await redeem(code, "&next=/settings")).statusCode).toBe(302);
    const again = await redeem(code, "&next=/settings");
    expect(again.statusCode).toBe(403);
    expect(proofCookies(again)).toHaveLength(0);
    expect(again.headers.location).toBeUndefined();
  });
});

// The store expires a code AT its TTL (`exp > now`), so exactly 60 s is already spent; the
// TTL is untouched by this change and `next` must not move the boundary.
describe("E27 — code TTL boundary is unchanged by next", () => {
  it.each([
    [59_999, true],
    [60_000, false],
    [60_001, false],
  ])("code aged %i ms → cookie set: %s", async (age, ok) => {
    const code = await mint();
    clock += age;
    const res = await redeem(code, "&next=/settings");
    expect(proofCookies(res)).toHaveLength(ok ? 1 : 0);
    expect(res.statusCode).toBe(ok ? 302 : 403);
    if (!ok) expect(res.headers.location).toBeUndefined();
  });
});

// ─── close-container-loopback-impersonation (D12): port-bound, short-lived proof cookie ────────────────────────────
const H = 3_600_000;
const MIN = 60_000;

describe("E10 — the proof cookie is bound to the port that issued it", () => {
  it("a cookie issued on port A is not proof on port B (same HOME and token); operate answers 403 local_proof_required", async () => {
    const a = createLocalTrustContext(TOKEN, () => true, () => 7001);
    const b = createLocalTrustContext(TOKEN, () => true, () => 7002);
    const cookie = signLocalProof(a);
    expect(verifyLocalProofCookie(cookie, a)).toBe(true);
    expect(verifyLocalProofCookie(cookie, b)).toBe(false);

    const guarded = Fastify();
    stampLegacyHook(guarded, TOKEN);
    await guarded.register(fastifyCookie);
    guarded.addHook("onRequest", createNetworkGuardHook({ trustedNetworks: [], localToken: TOKEN, localTrust: b }));
    guarded.post("/api/restart", async () => ({ ok: true }));
    await guarded.ready();
    const res = await guarded.inject({ method: "POST", url: "/api/restart", remoteAddress: "127.0.0.1", headers: { cookie: `${LOCAL_PROOF_COOKIE}=${cookie}` } });
    await guarded.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe("local_proof_required");
  });
});

describe("E11 — idle expiry (12 h, sliding via 1 h re-sign) and the 30-day cap", () => {
  afterEach(() => vi.useRealTimers());
  const strictCtx = createLocalTrustContext(TOKEN, () => true);
  const t0 = 2_000_000_000_000;

  it("59 min: admitted, no re-sign; 61 min: admitted and re-signed; 11h59m59s idle: admitted; 12h0m1s idle: not proof", () => {
    const cookie = signLocalProof(strictCtx, t0);
    expect(inspectLocalProofCookie(cookie, strictCtx, t0 + 59 * MIN)).toMatchObject({ needsRefresh: false });
    expect(inspectLocalProofCookie(cookie, strictCtx, t0 + 61 * MIN)).toMatchObject({ needsRefresh: true });
    expect(inspectLocalProofCookie(cookie, strictCtx, t0 + 12 * H - 1000)).not.toBeNull();
    expect(inspectLocalProofCookie(cookie, strictCtx, t0 + 12 * H + 1000)).toBeNull();
  });

  it("a re-signed cookie carries the new lastUse (idle window restarts) and keeps issuedAt", () => {
    const cookie = signLocalProof(strictCtx, t0);
    const refreshed = inspectLocalProofCookie(cookie, strictCtx, t0 + 61 * MIN)!.refreshed;
    expect(refreshed).not.toBe(cookie);
    expect(refreshed.split(".")[1]).toBe(cookie.split(".")[1]); // issuedAt unchanged
    expect(inspectLocalProofCookie(refreshed, strictCtx, t0 + 61 * MIN + 12 * H - 1000)).not.toBeNull();
    expect(inspectLocalProofCookie(refreshed, strictCtx, t0 + 61 * MIN + 12 * H + 1000)).toBeNull();
  });

  it("the 30-day absolute cap holds even with a fresh lastUse", () => {
    let cookie = signLocalProof(strictCtx, t0);
    for (let t = t0 + 11 * H; t < t0 + 30 * 24 * H; t += 11 * H) cookie = inspectLocalProofCookie(cookie, strictCtx, t)!.refreshed;
    const capEnd = t0 + 30 * 24 * H;
    // fresh lastUse, still inside the cap
    const fresh = inspectLocalProofCookie(cookie, strictCtx, capEnd - 2000)!.refreshed;
    expect(inspectLocalProofCookie(fresh, strictCtx, capEnd - 1000)).not.toBeNull();
    expect(inspectLocalProofCookie(fresh, strictCtx, capEnd + 1000)).toBeNull();
  });

  it("through the real hook: no Set-Cookie at +59 min, a re-signed Set-Cookie at +61 min, and nothing for an expired cookie", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const ctx2 = createLocalTrustContext(TOKEN, () => true);
    const cookie = signLocalProof(ctx2, t0);
    const hooked = Fastify();
    await hooked.register(fastifyCookie);
    registerLocalProofRoutes(hooked, { codes: new LocalProofCodeStore(() => clock), ctx: ctx2 });
    hooked.get("/x", async () => ({ ok: true }));
    await hooked.ready();
    const at = async (ms: number) => {
      vi.setSystemTime(ms);
      return hooked.inject({ method: "GET", url: "/x", headers: { cookie: `${LOCAL_PROOF_COOKIE}=${cookie}` } });
    };
    expect(proofCookies(await at(t0 + 59 * MIN))).toEqual([]);
    const resigned = proofCookies(await at(t0 + 61 * MIN));
    expect(resigned).toHaveLength(1);
    expect(resigned[0]).toMatch(/HttpOnly/i);
    expect(resigned[0]).toMatch(/SameSite=Strict/i);
    expect(proofCookies(await at(t0 + 13 * H))).toEqual([]); // idle past 12 h: not proof, so never refreshed
    await hooked.close();
  });
});
