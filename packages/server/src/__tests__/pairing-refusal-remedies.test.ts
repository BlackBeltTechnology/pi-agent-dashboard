/**
 * `describeApprovalRefusal` — pure reason + remedies for a refused pairing approval.
 * Exemplar: operate-required.test.ts.
 * See change: fix-pairing-approval-credential (test-plan E1–E6, E10 BVA via host).
 */
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { describeApprovalRefusal } from "../auth/approval-refusal.js";
import { buildLoginAvailable } from "../auth/auth-plugin.js";
import { createLocalTrustContext, LOCAL_PROOF_COOKIE, signLocalProof } from "../auth/local-proof.js";

type ReqSpec = { ip?: string; headers?: Record<string, string>; authVia?: string };
const req = (s: ReqSpec = {}) =>
  ({ ip: s.ip ?? "127.0.0.1", headers: s.headers ?? {}, authVia: s.authVia }) as unknown as FastifyRequest;

const LOCAL = { ip: "127.0.0.1", headers: { host: "localhost:8000" } } as const;
const base = { configPort: 8000, hostAdmitted: true } as const;
const oauthLogin = buildLoginAvailable(() => true, null, { enforced: () => false, loginConfigs: () => [] });

describe("E1/E2 — bare loopback on the launcher origin", () => {
  it("no login → authorize-browser then approve-on-host", () => {
    expect(describeApprovalRefusal(req(LOCAL), { ...base, loginAvailable: () => false })).toEqual({
      reason: "no-credential",
      remedies: ["authorize-browser", "approve-on-host"],
    });
  });
  it("login → sign-in appended in fixed order, no duplicates", () => {
    expect(describeApprovalRefusal(req(LOCAL), { ...base, loginAvailable: () => true })).toEqual({
      reason: "no-credential",
      remedies: ["authorize-browser", "approve-on-host", "sign-in"],
    });
  });
});

describe("E3/E4 — off-host peer (tunnel / LAN)", () => {
  const tunnel = { ip: "10.0.0.5", headers: { host: "pi.example.ts.net" } };
  it("OAuth clientId configured → approve-on-host + sign-in", () => {
    expect(describeApprovalRefusal(req(tunnel), { ...base, loginAvailable: oauthLogin })?.remedies).toEqual([
      "approve-on-host",
      "sign-in",
    ]);
  });
  it("no login → approve-on-host only", () => {
    expect(describeApprovalRefusal(req(tunnel), { ...base, loginAvailable: () => false })?.remedies).toEqual([
      "approve-on-host",
    ]);
  });
});

describe("E5/E6 — authorize-browser is withheld when it cannot help", () => {
  it("E5: loopback peer with X-Forwarded-For is not local", () => {
    const r = req({ ip: "127.0.0.1", headers: { host: "localhost:8000", "x-forwarded-for": "1.2.3.4" } });
    expect(describeApprovalRefusal(r, base)?.remedies).toEqual(["approve-on-host"]);
  });
  it("E6: a genuinely-local request already carrying a valid proof cookie", () => {
    const ctx = createLocalTrustContext("local-token-xyz", () => false);
    const r = req({
      ip: "127.0.0.1",
      headers: { host: "localhost:8000", cookie: `${LOCAL_PROOF_COOKIE}=${signLocalProof(ctx)}` },
    });
    const out = describeApprovalRefusal(r, { ...base, localTrust: ctx });
    expect(out?.remedies).not.toContain("authorize-browser");
    expect(out?.remedies).toEqual(["approve-on-host"]);
  });
});

describe("robustness", () => {
  it("device bearer → device-credential with no remedies", () => {
    const r = req({ ...LOCAL, authVia: "device" });
    expect(describeApprovalRefusal(r, { ...base, loginAvailable: () => true })).toEqual({
      reason: "device-credential",
      remedies: [],
    });
  });
  it("hostAdmitted false → null (legacy body)", () => {
    expect(describeApprovalRefusal(req(LOCAL), { ...base, hostAdmitted: false })).toBeNull();
  });
  it("a throwing loginAvailable only drops sign-in; absent likewise", () => {
    const boom = () => {
      throw new Error("boom");
    };
    expect(describeApprovalRefusal(req(LOCAL), { ...base, loginAvailable: boom })?.remedies).toEqual([
      "authorize-browser",
      "approve-on-host",
    ]);
    expect(describeApprovalRefusal(req(LOCAL), base)?.remedies).not.toContain("sign-in");
  });
  it("unknown configPort → no authorize-browser", () => {
    expect(describeApprovalRefusal(req(LOCAL), { hostAdmitted: true })?.remedies).toEqual(["approve-on-host"]);
  });
  it.each([
    ["other port", "localhost:9000"],
    ["implicit port 80 vs cfg 8000", "localhost"],
    ["userinfo", "localhost:8000@evil"],
    ["unterminated IPv6", "[::1"],
    ["path smuggled", "localhost:8000/x"],
    ["non-loopback name", "localhost.evil.com:8000"],
    ["empty", ""],
  ])("spoofed Host (%s) → no authorize-browser, never throws", (_n, host) => {
    const r = req({ ip: "127.0.0.1", headers: { host } });
    expect(describeApprovalRefusal(r, base)?.remedies).toEqual(["approve-on-host"]);
  });
  it("missing Host header → no authorize-browser", () => {
    expect(describeApprovalRefusal(req({ ip: "127.0.0.1" }), base)?.remedies).toEqual(["approve-on-host"]);
  });
  it.each(["LOCALHOST:8000", "127.0.0.1:8000", "[::1]:8000"])("Host %s counts (case-insensitive)", (host) => {
    const r = req({ ip: "127.0.0.1", headers: { host } });
    expect(describeApprovalRefusal(r, base)?.remedies).toEqual(["authorize-browser", "approve-on-host"]);
  });
  it("body carries nothing request-derived", () => {
    const out = describeApprovalRefusal(req({ ip: "127.0.0.1", headers: { host: "localhost:8000" } }), base);
    expect(Object.keys(out ?? {}).sort()).toEqual(["reason", "remedies"]);
    expect(JSON.stringify(out)).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});
