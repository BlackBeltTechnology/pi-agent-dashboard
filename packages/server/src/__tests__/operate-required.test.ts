/**
 * `hasOperateAuthority` keeps today's admission decisions; `sendOperateRequired`
 * derives reason + remedies from markers already on the request and emits only
 * the five spec keys.
 * See change: surface-operate-required-remedy (test-plan E1, E2, P1).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { createLocalTrustContext } from "../auth/local-proof.js";
import { hasOperateAuthority, sendOperateRequired } from "../auth/operate-required.js";
import { createRequestAccessAvailable } from "../pairing/knock-admission.js";
import { stampedHeaders } from "../test-support/local-credential-stamp.js";

type ReqSpec = { ip?: string; headers?: Record<string, string>; authVia?: string; principalTier?: string };
const req = (s: ReqSpec = {}) => ({ ip: s.ip ?? "192.168.16.220", headers: s.headers ?? {}, authVia: s.authVia, principalTier: s.principalTier }) as unknown as FastifyRequest;

function stubReply() {
  const out: { status?: number; body?: unknown } = {};
  const reply = {
    code(n: number) { out.status = n; return reply; },
    send(b: unknown) { out.body = b; return Promise.resolve(reply); },
  } as unknown as FastifyReply;
  return { reply, out };
}

const MESSAGES = {
  vault: {
    "no-credential": "the vault needs an operate-tier credential or a locally trusted caller",
    "tier-too-low": "the vault needs an operate-tier credential; this device's credential has a lower tier",
  },
  services: {
    "no-credential": "service mutations need an operate-tier credential or a locally trusted caller",
    "tier-too-low": "service mutations need an operate-tier credential; this device's credential has a lower tier",
  },
} as const;

describe("E1 hasOperateAuthority keeps today's decisions", () => {
  it.each([
    ["device operate", { authVia: "device", principalTier: "operate" }, true],
    ["device control", { authVia: "device", principalTier: "control" }, false],
    ["device observe", { authVia: "device", principalTier: "observe" }, false],
    ["session", { authVia: "session" }, true],
    ["principal", { authVia: "principal" }, true],
    ["loopback", { ip: "127.0.0.1" }, true],
    ["loopback + x-forwarded-for", { ip: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } }, false],
    ["LAN, no credential", {}, false],
  ] as const)("%s → %s", (_l, spec, expected) => {
    expect(hasOperateAuthority(req(spec))).toBe(expected);
  });

  it("strict loopback without proof is refused", () => {
    const strict = createLocalTrustContext("local-token-xyz", () => true);
    expect(hasOperateAuthority(req({ ip: "127.0.0.1" }), strict)).toBe(false);
  });
});

describe("E2 refusal reason + remedies", () => {
  it.each([
    // [label, request, loginAvailable, reason, remedies]
    ["LAN no credential", {}, false, "no-credential", ["use-host"]],
    ["LAN no credential + login", {}, true, "no-credential", ["use-host", "sign-in"]],
    ["LAN control device", { authVia: "device", principalTier: "control" }, false, "tier-too-low", ["use-host", "re-pair"]],
    ["LAN observe device + login", { authVia: "device", principalTier: "observe" }, true, "tier-too-low", ["use-host", "re-pair", "sign-in"]],
    ["local observe device", { ip: "127.0.0.1", authVia: "device", principalTier: "observe" }, false, "tier-too-low", ["re-pair"]],
    ["local observe device + login", { ip: "127.0.0.1", authVia: "device", principalTier: "observe" }, true, "tier-too-low", ["re-pair", "sign-in"]],
  ] as const)("%s", async (_l, spec, login, reason, remedies) => {
    for (const route of ["vault", "services"] as const) {
      const { reply, out } = stubReply();
      await sendOperateRequired(req(spec), reply, { route, loginAvailable: () => login });
      expect(out.status).toBe(403);
      const body = out.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(["error", "message", "reason", "remedies", "success"]);
      expect(body.success).toBe(false);
      expect(body.error).toBe("operate_required");
      expect(body.reason).toBe(reason);
      expect(body.remedies).toEqual(remedies);
      expect(body.message).toBe(MESSAGES[route][reason]);
    }
  });

  it("calls loginAvailable once per refusal (live, not captured)", async () => {
    let calls = 0;
    const { reply } = stubReply();
    await sendOperateRequired(req(), reply, { route: "vault", loginAvailable: () => (calls++, true) });
    expect(calls).toBe(1);
  });
});

describe("P1 builder latency", () => {
  it("1000 sequential refusals with all three login sources composed stay ≤ 1000 ms", async () => {
    const { buildLoginAvailable } = await import("../auth/auth-plugin.js");
    const loginAvailable = buildLoginAvailable(() => false, { isEnabled: () => false }, { enforced: () => true, loginConfigs: () => [{}] });
    const r = req({ authVia: "device", principalTier: "control" });
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const { reply } = stubReply();
      await sendOperateRequired(r, reply, { route: "vault", loginAvailable });
    }
    expect(performance.now() - start).toBeLessThanOrEqual(1000);
  });
});

// ── add-request-access-remedy (test-plan E4, E5, X5, P1) ──────────────────
describe("E4 request-access presence decision table", () => {
  const authVias = [
    ["no credential", {}],
    ["device control", { authVia: "device", principalTier: "control" }],
    ["session control", { authVia: "session", principalTier: "control" }],
    ["principal", { authVia: "principal" }],
  ] as const;
  const thunks = [
    ["true", () => true],
    ["false", () => false],
    ["omitted", undefined],
  ] as const;

  it.each(
    authVias.flatMap(([a, spec]) =>
      thunks.flatMap(([t, fn]) => [true, false].map((login) => [a, spec, t, fn, login] as const)),
    ),
  )("authVia=%s thunk=%s login=%s", async (_a, spec, _t, fn, login) => {
    const { reply, out } = stubReply();
    await sendOperateRequired(req(spec), reply, { route: "vault", loginAvailable: () => login, requestAccessAvailable: fn });
    const body = out.body as { remedies: string[]; reason: string };
    expect(Object.keys(out.body as object).sort()).toEqual(["error", "message", "reason", "remedies", "success"]);
    const expectPresent = (spec as ReqSpec).authVia === undefined && fn?.() === true;
    expect(body.remedies.includes("request-access")).toBe(expectPresent);
    if (body.remedies.includes("re-pair")) expect(body.remedies).not.toContain("request-access");
    if (expectPresent) expect(body.remedies).toEqual(login ? ["use-host", "request-access", "sign-in"] : ["use-host", "request-access"]);
  });

  it("calls the thunk with the refused request", async () => {
    const seen: unknown[] = [];
    const r = req();
    const { reply } = stubReply();
    await sendOperateRequired(r, reply, { route: "vault", loginAvailable: () => false, requestAccessAvailable: (x) => (seen.push(x), true) });
    expect(seen).toEqual([r]);
  });
});

describe("E5 / X5 requestAccessAvailable thunk", () => {
  const IFACE = [{ address: "192.168.16.1", netmask: "255.255.255.0" }];
  const trust = createLocalTrustContext("local-token-xyz", () => true);
  const mk = (interfaces = IFACE) => createRequestAccessAvailable({ hostAdmission: () => ({}), getLanInterfaces: () => interfaces }, trust);
  const onLink = (headers: Record<string, string> = {}) =>
    ({ ip: "192.168.16.40", socket: { remoteAddress: "192.168.16.40" }, headers: { host: "192.168.16.1:8000", ...headers } }) as unknown as FastifyRequest;

  it("false with a valid X-Pi-Local-Token, true without", () => {
    const thunk = mk();
    expect(thunk(onLink())).toBe(true);
    const stamped = { ...onLink(), headers: stampedHeaders({ host: "192.168.16.1:8000", "x-pi-local-token": "local-token-xyz" }, "local-token-xyz") };
    expect(thunk(stamped as unknown as FastifyRequest)).toBe(false);
  });

  it("false with a verified pi_dash_local proof cookie", async () => {
    const { signLocalProof } = await import("../auth/local-proof.js");
    const cookie = signLocalProof(trust);
    expect(mk()(onLink({ cookie: `pi_dash_local=${cookie}` }))).toBe(false);
  });

  it("an empty interface list fails closed", () => {
    expect(mk([])(onLink())).toBe(false);
  });
});

describe("P1 builder latency with the knock-gate thunk", () => {
  it("1000 on-link refusals with the real thunk and all three login sources stay ≤ 1000 ms", async () => {
    const { buildLoginAvailable } = await import("../auth/auth-plugin.js");
    const loginAvailable = buildLoginAvailable(() => false, { isEnabled: () => false }, { enforced: () => true, loginConfigs: () => [{}] });
    const requestAccessAvailable = createRequestAccessAvailable(
      { hostAdmission: () => ({}), getLanInterfaces: () => [{ address: "192.168.16.1", netmask: "255.255.255.0" }] },
      createLocalTrustContext("t", () => false),
    );
    const r = { ip: "192.168.16.40", socket: { remoteAddress: "192.168.16.40" }, headers: { host: "192.168.16.1:8000" } } as unknown as FastifyRequest;
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const { reply } = stubReply();
      await sendOperateRequired(r, reply, { route: "vault", loginAvailable, requestAccessAvailable });
    }
    expect(performance.now() - start).toBeLessThanOrEqual(1000);
  });
});
