/**
 * `GET /auth/local-proof?next=` — same-origin redirect after redeeming a local-proof code.
 * Exemplar: local-proof-strict.test.ts ("local-proof bootstrap").
 * See change: fix-pairing-approval-credential (test-plan E24–E28).
 */
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalTrustContext, LocalProofCodeStore } from "../auth/local-proof.js";
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
