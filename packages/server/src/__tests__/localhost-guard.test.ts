import net from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createNetworkGuard,
  createNetworkGuardHook,
  GUARD_DENY_REASON,
  type GuardDenialLogEntry,
  guardPathname,
  ipToNum,
  isBypassedHost,
  isGuardJurisdiction,
  localhostGuard,
  matchCidr,
  netmaskToCidrBits,
  networkAddress,
} from "../auth/localhost-guard.js";
import { isLoopback } from "../auth/loopback.js";
import { buildNetworkInterfaceList } from "../routes/network-interfaces.js";
import { PUBLIC_PAIRING_PREFIXES } from "../routes/pairing-routes.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";
import { blockEvents } from "../tunnel/tunnel-block-events.js";

describe("isLoopback", () => {
  it("should match loopback addresses", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("::ffff:127.0.0.1")).toBe(true);
  });

  it("should reject non-loopback", () => {
    expect(isLoopback("192.168.1.1")).toBe(false);
    expect(isLoopback("10.0.0.1")).toBe(false);
  });

  // test-plan #E2 — semantics preserved by the extraction into auth/loopback.ts.
  // See change: cleanup-import-cycles (D1).
  it("matches every member of the loopback set from the extracted leaf module", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      expect(isLoopback(ip), ip).toBe(true);
    }
  });

  it("rejects a documentation-range address and a non-string-ish input", () => {
    expect(isLoopback("203.0.113.1")).toBe(false);
    expect(isLoopback(undefined as unknown as string)).toBe(false);
  });
});

describe("isBypassedHost", () => {
  it("should match exact IP", () => {
    expect(isBypassedHost("192.168.1.42", ["192.168.1.42"])).toBe(true);
    expect(isBypassedHost("192.168.1.43", ["192.168.1.42"])).toBe(false);
  });

  it("should match wildcard", () => {
    expect(isBypassedHost("10.0.0.5", ["10.0.0.*"])).toBe(true);
    expect(isBypassedHost("10.0.1.5", ["10.0.0.*"])).toBe(false);
  });

  it("treats a regex metacharacter in a wildcard entry as a literal, not a pattern", () => {
    // A config entry is DATA: only `*` is a wildcard. `\d+` must not become a
    // regex (CodeQL "incomplete string escaping").
    expect(isBypassedHost("10.0.0.1", ["10.0.0.\\d+"])).toBe(false);
    expect(isBypassedHost("1.1.1.1", ["10.0.0.*|1.1.1.*"])).toBe(false);
  });

  it("should match CIDR", () => {
    expect(isBypassedHost("192.168.1.42", ["192.168.1.0/24"])).toBe(true);
    expect(isBypassedHost("192.168.2.1", ["192.168.1.0/24"])).toBe(false);
  });

  it("should match wide CIDR", () => {
    expect(isBypassedHost("10.255.0.1", ["10.0.0.0/8"])).toBe(true);
    expect(isBypassedHost("11.0.0.1", ["10.0.0.0/8"])).toBe(false);
  });

  it("should return false for empty list", () => {
    expect(isBypassedHost("192.168.1.1", [])).toBe(false);
  });

  it("should match any entry in the list", () => {
    expect(isBypassedHost("10.0.0.5", ["192.168.1.0/24", "10.0.0.*"])).toBe(true);
  });

  it("should strip ::ffff: IPv4-mapped prefix", () => {
    expect(isBypassedHost("::ffff:192.168.1.42", ["192.168.1.0/24"])).toBe(true);
    expect(isBypassedHost("::ffff:10.0.0.5", ["10.0.0.*"])).toBe(true);
    expect(isBypassedHost("::ffff:10.0.0.5", ["10.0.0.5"])).toBe(true);
    expect(isBypassedHost("::ffff:192.168.2.1", ["192.168.1.0/24"])).toBe(false);
  });
});

describe("matchCidr", () => {
  it("should handle /32 (exact match)", () => {
    expect(matchCidr("10.0.0.1", "10.0.0.1/32")).toBe(true);
    expect(matchCidr("10.0.0.2", "10.0.0.1/32")).toBe(false);
  });

  it("should handle /0 (match all)", () => {
    expect(matchCidr("1.2.3.4", "0.0.0.0/0")).toBe(true);
  });

  it("should reject invalid CIDR bits", () => {
    expect(matchCidr("10.0.0.1", "10.0.0.0/33")).toBe(false);
    expect(matchCidr("10.0.0.1", "10.0.0.0/-1")).toBe(false);
  });
});

describe("ipToNum", () => {
  it("should convert valid IPv4", () => {
    expect(ipToNum("0.0.0.0")).toBe(0);
    expect(ipToNum("255.255.255.255")).toBe(0xFFFFFFFF);
    expect(ipToNum("192.168.1.1")).toBe((192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0);
  });

  it("should return null for invalid input", () => {
    expect(ipToNum("not-an-ip")).toBeNull();
    expect(ipToNum("::1")).toBeNull();
    expect(ipToNum("256.0.0.0")).toBeNull();
  });
});

describe("netmaskToCidrBits", () => {
  it("should convert common netmasks", () => {
    expect(netmaskToCidrBits("255.255.255.0")).toBe(24);
    expect(netmaskToCidrBits("255.255.0.0")).toBe(16);
    expect(netmaskToCidrBits("255.0.0.0")).toBe(8);
    expect(netmaskToCidrBits("255.255.255.255")).toBe(32);
    expect(netmaskToCidrBits("0.0.0.0")).toBe(0);
    expect(netmaskToCidrBits("255.255.255.128")).toBe(25);
  });
});

describe("networkAddress", () => {
  it("should compute network address", () => {
    expect(networkAddress("192.168.1.42", "255.255.255.0")).toBe("192.168.1.0");
    expect(networkAddress("10.0.5.100", "255.255.0.0")).toBe("10.0.0.0");
    expect(networkAddress("172.16.3.1", "255.0.0.0")).toBe("172.0.0.0");
  });
});

describe("createNetworkGuard", () => {
  function mockRequest(ip: string, isAuthenticated = false) {
    return { ip, isAuthenticated } as any;
  }

  function mockReply() {
    const r: any = { statusCode: 0, body: null };
    r.code = (c: number) => { r.statusCode = c; return r; };
    r.send = (b: any) => { r.body = b; return r; };
    return r;
  }

  it("should allow loopback", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("127.0.0.1"), reply);
    expect(reply.statusCode).toBe(0);
  });

  it("should allow trusted network CIDR", async () => {
    const guard = createNetworkGuard(["192.168.1.0/24"]);
    const reply = mockReply();
    await guard(mockRequest("192.168.1.42"), reply);
    expect(reply.statusCode).toBe(0);
  });

  it("should allow authenticated request", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("203.0.113.5", true), reply);
    expect(reply.statusCode).toBe(0);
  });

  it("should block untrusted unauthenticated request", async () => {
    const guard = createNetworkGuard(["192.168.1.0/24"]);
    const reply = mockReply();
    await guard(mockRequest("10.0.0.5", false), reply);
    expect(reply.statusCode).toBe(403);
  });

  it("should block when no trusted networks and not authenticated", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("192.168.1.5", false), reply);
    expect(reply.statusCode).toBe(403);
  });

  it("denial body is self-describing { success, error, reason, hint }", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("192.168.1.5", false), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.success).toBe(false);
    expect(reply.body.error).toBe("network_not_allowed");
    expect(typeof reply.body.reason).toBe("string");
    expect(reply.body.reason.length).toBeGreaterThan(0);
    expect(typeof reply.body.hint).toBe("string");
    // hint must name the remedy: trustedNetworks and/or sign in
    expect(reply.body.hint).toMatch(/trustedNetworks/i);
    expect(reply.body.hint).toMatch(/sign in/i);
  });

  it("does not emit the network_not_allowed body when authenticated", async () => {
    const guard = createNetworkGuard([]);
    const reply = mockReply();
    await guard(mockRequest("203.0.113.5", true), reply);
    expect(reply.statusCode).toBe(0);
    expect(reply.body).toBeNull();
  });
});

// ── /api/network-interfaces hardening (test-plan #X3–#X4) ──────────────
// See change: warn-unreachable-trusted-networks.
describe("/api/network-interfaces hardening", () => {
  it("#X3 denies a non-loopback caller — the endpoint's preHandler is unchanged", async () => {
    const sent: { code?: number; body?: unknown } = {};
    const reply = {
      code(c: number) { sent.code = c; return this; },
      send(b: unknown) { sent.body = b; return this; },
    };
    await localhostGuard({ ip: "192.168.1.9" } as never, reply as never);
    expect(sent.code).toBe(403);
  });

  it("#X3 still admits a loopback caller", async () => {
    let code: number | undefined;
    const reply = { code(c: number) { code = c; return this; }, send() { return this; } };
    await localhostGuard({ ip: "127.0.0.1" } as never, reply as never);
    expect(code).toBeUndefined();
  });

  it("#X4 surfaces an enumeration failure as an error instead of throwing", () => {
    const out = buildNetworkInterfaceList(() => { throw new Error("EPERM: interfaces unavailable"); });
    expect(out.success).toBe(false);
    expect(out.success === false && out.error).toContain("EPERM");
  });

  it("#X4 enriches each address with label, pointToPoint, and suggestions", () => {
    const out = buildNetworkInterfaceList(() => ({
      utun4: [{ address: "100.97.246.31", netmask: "255.255.255.255", family: "IPv4", internal: false, mac: "", cidr: null } as never],
    }));
    expect(out.success).toBe(true);
    const entry = out.success === true ? out.data[0] : undefined;
    expect(entry?.pointToPoint).toBe(true);
    expect(entry?.label).toBe("tailnet");
    expect(entry?.suggestions).toEqual([
      { value: "100.64.0.0/10", label: "tailnet CGNAT range", wide: true },
    ]);
  });
});

// ─── Universal network guard hook ────────────────────────────────────────────
// Change: add-universal-network-guard. Exercises `createNetworkGuardHook` — the
// single structural guard that replaced per-route `preHandler` opt-in as the
// protection boundary, and which runs even when auth is not configured.

interface GuardAppOptions {
  /** Fixed list or live thunk (D15). */
  trusted?: string[] | (() => string[]);
  bypassUrls?: string[];
  pairing?: readonly string[];
  localToken?: string;
  /**
   * Adds an EARLIER `onRequest` hook that marks the request authenticated —
   * exactly what `registerBearerAuth` / the OAuth plugin / the model-proxy gate
   * do in `server.ts`, so the guard observes `isAuthenticated === true`.
   */
  priorAuthHook?: boolean;
  logDenial?: (entry: GuardDenialLogEntry) => void;
  /** Register extra routes (registered BEFORE the guard hook). */
  routes?: (app: FastifyInstance) => void;
}

/**
 * None of the default routes carries a per-route `preHandler` — that absence is
 * the property under test (the guard protects them structurally).
 */
function defaultRoutes(app: FastifyInstance): void {
  app.get("/api/sessions", async () => ({ ok: true }));
  app.put("/api/provider-auth/api-key", async () => ({ ok: true }));
  app.post("/api/pair/redeem", async () => ({ ok: true }));
  app.post("/api/ws-ticket", async () => ({ ok: true }));
  app.get("/api/health", async () => ({ ok: true }));
  // Anchored-matching probes: a near-miss under /api, and a near-miss /api prefix.
  app.get("/api/healthz", async () => ({ ok: true }));
  app.get("/apiv2/x", async () => ({ ok: true }));
  app.get("/settings", async () => ({ ok: true }));
}

/**
 * Routes are registered BEFORE the guard hook, mirroring `server.ts` — which
 * pins the load-bearing Fastify invariant (also asserted in the real-server
 * suite) that a root `onRequest` hook registered last still binds to routes
 * registered earlier.
 */
async function buildGuardApp(opts: GuardAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("isAuthenticated", false);
  if (opts.priorAuthHook) {
    app.addHook("onRequest", async (request) => {
      (request as unknown as { isAuthenticated: boolean }).isAuthenticated = true;
    });
  }
  (opts.routes ?? defaultRoutes)(app);
  app.addHook(
    "onRequest",
    createNetworkGuardHook({
      trustedNetworks: opts.trusted ?? [],
      localToken: opts.localToken,
      getBypassUrls: () => opts.bypassUrls ?? [],
      getPairingPrefixes: () => opts.pairing ?? PUBLIC_PAIRING_PREFIXES,
      logDenial: opts.logDenial,
    }),
  );
  return app;
}

const UNTRUSTED = "203.0.113.5"; // TEST-NET-3, never a real peer

describe("guardPathname / isGuardJurisdiction (pathname matching)", () => {
  it("strips the query string and the fragment", () => {
    expect(guardPathname("/api/health?probe=1")).toBe("/api/health");
    expect(guardPathname("/api/sessions?a=1&b=2#frag")).toBe("/api/sessions");
    expect(guardPathname("/api/health#frag")).toBe("/api/health");
  });

  it("fails closed on a target it cannot parse", () => {
    // Malformed percent-escape → no route could have matched it.
    expect(guardPathname("/api/%zz")).toBeNull();
    expect(guardPathname("/api/100%")).toBeNull();
    // Authority-form / absolute-form targets are anomalous for this server.
    expect(guardPathname("//evil.example/api")).toBeNull();
    expect(guardPathname("http://evil.example/api")).toBeNull();
    expect(guardPathname("api/sessions")).toBeNull();
    expect(guardPathname(undefined)).toBeNull();
    expect(guardPathname("/")).toBe("/");
  });

  it("anchors jurisdiction on the trailing slash", () => {
    for (const p of ["/api/", "/v1/", "/editor/", "/live/"]) {
      expect(isGuardJurisdiction(p), p).toBe(true);
    }
    expect(isGuardJurisdiction("/api/sessions")).toBe(true);
    expect(isGuardJurisdiction("/v1/messages")).toBe(true);
    // Near-misses must NOT enter jurisdiction.
    expect(isGuardJurisdiction("/apiv2/x")).toBe(false);
    expect(isGuardJurisdiction("/api")).toBe(false);
    // The SPA shell, static assets, /auth/* and the /mcp namespace are outside.
    expect(isGuardJurisdiction("/")).toBe(false);
    expect(isGuardJurisdiction("/sw.js")).toBe(false);
    expect(isGuardJurisdiction("/settings")).toBe(false);
    expect(isGuardJurisdiction("/auth/status")).toBe(false);
    expect(isGuardJurisdiction("/mcp")).toBe(false);
  });
});

describe("universal guard — deny by default (S1, S3, S4, S8)", () => {
  // test-plan #S1
  it("denies an untrusted public peer on a route with NO per-route preHandler", async () => {
    const loginConfigRoutes = (a: FastifyInstance): void => {
      defaultRoutes(a);
      a.get("/api/identity/login-config", async () => ({ active: false }));
    };
    const loginApp = await buildGuardApp({ routes: loginConfigRoutes });
    // D16 (LG-3): the browser is the login target and holds no token yet, so the
    // pre-auth descriptor must pass the universal guard like /api/health does.
    const admitted = await loginApp.inject({
      method: "GET",
      url: "/api/identity/login-config",
      remoteAddress: UNTRUSTED,
    });
    expect(admitted.statusCode).toBe(200);
    // Control: a normal /api path from the same untrusted network is still denied.
    const denied = await loginApp.inject({ method: "GET", url: "/api/sessions", remoteAddress: UNTRUSTED });
    expect(denied.statusCode).toBe(403);
    await loginApp.close();

    const app = await buildGuardApp();
    const res = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: UNTRUSTED });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("network_not_allowed");
  });

  // test-plan #S3 — auth OFF, the audit VD2 route (plugin route under /api).
  it("denies the automation plugin create route from a tunnel peer with auth off", async () => {
    const app = await buildGuardApp({
      routes: (a) => {
        a.post("/api/plugins/automation/create", async () => ({ ok: true }));
      },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/automation/create",
      remoteAddress: UNTRUSTED,
      // A tunnel relays through a proxy and injects forwarding headers; either
      // signal alone must defeat genuine-local admission.
      headers: { "x-forwarded-for": UNTRUSTED },
      payload: { name: "pwn" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("network_not_allowed");
  });

  // test-plan #S4
  it("denies an untrusted unauthenticated provider-auth key write with auth off", async () => {
    const app = await buildGuardApp();
    const res = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      remoteAddress: UNTRUSTED,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  // test-plan #S8 — the ws-ticket mint is guarded, NOT public.
  it("denies an untrusted unauthenticated ws-ticket mint", async () => {
    const app = await buildGuardApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/ws-ticket",
      remoteAddress: UNTRUSTED,
      payload: { scope: "session" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("network_not_allowed");
  });
});

describe("universal guard — pass conditions (S2, S5, S25)", () => {
  // test-plan #S2 — the guard is LAST, so a prior auth hook's decision is visible.
  it("admits a request a prior auth hook marked authenticated", async () => {
    const app = await buildGuardApp({ priorAuthHook: true });
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: UNTRUSTED,
      headers: { authorization: "Bearer simulated-valid-bearer" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  // test-plan #S5
  it("admits a genuine-local loopback request with auth off", async () => {
    const app = await buildGuardApp();
    const res = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: "127.0.0.1" });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("refuses a loopback peer that carries a proxy-forwarding header", async () => {
    const app = await buildGuardApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": UNTRUSTED },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  // test-plan #S25 — live thunk, never a boot snapshot.
  it("admits a CIDR added to the trusted set at runtime, without a restart", async () => {
    let trusted: string[] = [];
    const app = await buildGuardApp({ trusted: () => trusted });

    const before = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: "10.4.0.9" });
    expect(before.statusCode, "untrusted before the CIDR is added").toBe(403);

    trusted = ["10.4.0.0/16"];

    const after = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: "10.4.0.9" });
    await app.close();
    expect(after.statusCode, "admitted by the runtime-added CIDR").toBe(200);
  });
});

describe("universal guard — in-namespace public exceptions (S6, S7, S20, S25)", () => {
  // test-plan #S6
  it("admits an untrusted unauthenticated GET /api/health", async () => {
    const app = await buildGuardApp();
    const res = await app.inject({ method: "GET", url: "/api/health", remoteAddress: UNTRUSTED });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  // test-plan #S25 — Fastify auto-exposes HEAD for a GET route; the exception is
  // not GET-only.
  it("admits an untrusted unauthenticated HEAD /api/health", async () => {
    const app = await buildGuardApp();
    const res = await app.inject({ method: "HEAD", url: "/api/health", remoteAddress: UNTRUSTED });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  // test-plan #S7
  it("admits an unauthenticated pairing-bootstrap path", async () => {
    const app = await buildGuardApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/redeem",
      remoteAddress: UNTRUSTED,
      payload: { code: "123456" },
    });
    await app.close();
    // Reaches the handler rather than being network-denied.
    expect(res.statusCode).toBe(200);
  });

  // test-plan #S20 / #S19 — the whole point of pathname matching.
  it("admits /api/health?probe=1 but denies /api/healthz (exact, not loose prefix)", async () => {
    const app = await buildGuardApp();

    const withQuery = await app.inject({
      method: "GET",
      url: "/api/health?probe=1",
      remoteAddress: UNTRUSTED,
    });
    expect(withQuery.statusCode, "query string must not defeat the exception").toBe(200);

    const nearMiss = await app.inject({
      method: "GET",
      url: "/api/healthz",
      remoteAddress: UNTRUSTED,
    });
    expect(nearMiss.statusCode, "anchored exception must not admit a near-miss").toBe(403);

    // Out of jurisdiction entirely → the guard is a no-op.
    const outOfJurisdiction = await app.inject({
      method: "GET",
      url: "/apiv2/x",
      remoteAddress: UNTRUSTED,
    });
    await app.close();
    expect(outOfJurisdiction.statusCode, "/apiv2 must not be treated as /api").toBe(200);
  });

  it("admits a configured bypassUrls prefix", async () => {
    const app = await buildGuardApp({
      bypassUrls: ["/api/publications"],
      routes: (a) => {
        a.get("/api/publications", async () => ({ ok: true }));
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/publications",
      remoteAddress: UNTRUSTED,
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("universal guard — fails closed and logs (S18, S23, S25)", () => {
  // test-plan #S25 — an unparseable target cannot be proven out of jurisdiction.
  it("denies an unparseable URL (fail closed)", async () => {
    const app = await buildGuardApp();
    // Inject through Fastify so the whole lifecycle runs; Fastify itself may
    // reject the malformed target before routing, so assert the guard's own
    // decision directly as well.
    const logged: GuardDenialLogEntry[] = [];
    const hook = createNetworkGuardHook({
      trustedNetworks: [],
      logDenial: (e) => logged.push(e),
    });
    const reply = {
      status: undefined as number | undefined,
      body: undefined as unknown,
      code(c: number) {
        this.status = c;
        return this;
      },
      send(b: unknown) {
        this.body = b;
        return this;
      },
    };
    await hook(
      { url: "/api/%zz", method: "GET", ip: UNTRUSTED, headers: {} } as never,
      reply as never,
    );
    await app.close();

    expect(reply.status).toBe(403);
    expect((reply.body as { error: string }).error).toBe("network_not_allowed");
    expect(logged).toHaveLength(1);
    expect(logged[0].reason).toBe(GUARD_DENY_REASON.unparseableUrl);
  });

  // test-plan #S18 — path + IP + reason, and nothing else.
  it("logs path, source IP and reason — never the body or a credential", async () => {
    const logged: GuardDenialLogEntry[] = [];
    const app = await buildGuardApp({ logDenial: (e) => logged.push(e) });

    const res = await app.inject({
      method: "POST",
      url: "/api/sessions",
      remoteAddress: UNTRUSTED,
      headers: { authorization: "Bearer super-secret-token", cookie: "pi_session=super-secret-cookie" },
      payload: { prompt: "super-secret-body" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toEqual({
      path: "/api/sessions",
      ip: UNTRUSTED,
      reason: GUARD_DENY_REASON.noPassCondition,
    });

    const serialised = JSON.stringify(logged);
    for (const secret of ["super-secret-token", "super-secret-cookie", "super-secret-body"]) {
      expect(serialised, `log must not leak ${secret}`).not.toContain(secret);
    }
  });

  // test-plan #S23 — the shared denial path, so already-guarded routes keep their shape.
  it("keeps the network_not_allowed body and records the denial in blockEvents", async () => {
    blockEvents.clear();
    const app = await buildGuardApp();

    const res = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: UNTRUSTED });
    await app.close();

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("network_not_allowed");
    expect(body.success).toBe(false);
    expect(typeof body.reason).toBe("string");
    expect(typeof body.hint).toBe("string");

    const recorded = blockEvents.list().find((e) => e.ip === UNTRUSTED);
    expect(recorded, "denial must feed GET /api/tunnel/block-events").toBeDefined();
    expect(recorded?.trustable).toBe(true);
  });
});

describe("universal guard — documented preHandler interplay (S22, S1)", () => {
  // test-plan #S22 — a bypassUrls exception does NOT widen a route that carries
  // its own per-route guard. This is exactly today's behaviour (bypassUrls has
  // only ever skipped the auth plugin), so the change adds no regression.
  it("still 403s a bypassUrls-matching route that carries a per-route networkGuard", async () => {
    const app = await buildGuardApp({
      bypassUrls: ["/api/bypassed"],
      routes: (a) => {
        a.get("/api/bypassed", { preHandler: createNetworkGuard([]) }, async () => ({ ok: true }));
      },
    });
    const res = await app.inject({ method: "GET", url: "/api/bypassed", remoteAddress: UNTRUSTED });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("network_not_allowed");
  });

  it("does not double-reply when a guarded route also carries the per-route guard", async () => {
    const TRUSTED_CIDR = ["10.0.0.0/8"];
    const app = await buildGuardApp({
      // Same trusted set for the hook and the preHandler — the pass conditions
      // agree, so the two must reach the same verdict.
      trusted: TRUSTED_CIDR,
      routes: (a) => {
        a.get("/api/double", { preHandler: createNetworkGuard(TRUSTED_CIDR) }, async () => ({ ok: true }));
      },
    });
    // Trusted for BOTH the hook and the preHandler → admitted exactly once.
    const ok = await app.inject({ method: "GET", url: "/api/double", remoteAddress: "10.0.0.7" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(true);
    // Untrusted for both → the hook denies; the preHandler never runs.
    const denied = await app.inject({ method: "GET", url: "/api/double", remoteAddress: UNTRUSTED });
    await app.close();
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toBe("network_not_allowed");
  });
});

// ─── The guard as actually registered in server.ts ────────────────────────────
// The hook tests above prove the DECISION is right; these prove the hook is
// wired into the real server, LAST and unconditionally, so the audit gap (auth
// off ⇒ no rejecting hook at all) is actually closed. They also exercise the
// Fastify invariant a late root hook relies on: bound at `preReady`, so it
// covers the ~200 routes registered before it.
describe("universal guard wired into the real server (S1, S4, S5, S6)", () => {
  let handle: TestServerHandle;
  // A tunnel/proxy peer: loopback socket + a forwarding header defeats
  // genuine-local admission, which is exactly how a zrok-relayed request looks.
  const TUNNELED = { "x-forwarded-for": UNTRUSTED };

  beforeAll(async () => {
    handle = await createTestServer();
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
  });

  const url = (p: string) => `http://127.0.0.1:${handle.httpPort}${p}`;

  // test-plan #S1 — no per-route preHandler is required for protection.
  it("denies an untrusted tunneled peer on /api/sessions", async () => {
    const res = await fetch(url("/api/sessions"), { headers: TUNNELED });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("network_not_allowed");
  });

  // test-plan #S5
  it("admits a genuine-local loopback caller", async () => {
    const res = await fetch(url("/api/sessions"));
    expect(res.status).toBe(200);
  });

  // test-plan #S6
  it("admits an untrusted unauthenticated GET /api/health", async () => {
    const res = await fetch(url("/api/health"), { headers: TUNNELED });
    expect(res.status).toBe(200);
  });

  // test-plan #S4 — provider-auth is one of the three surfaces the audit found ungated.
  it("denies an untrusted unauthenticated provider-auth key write", async () => {
    const res = await fetch(url("/api/provider-auth/api-key"), {
      method: "PUT",
      headers: { ...TUNNELED, "content-type": "application/json" },
      body: JSON.stringify({ provider: "anthropic", key: "sk-should-not-land" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("network_not_allowed");
  });

  // The SPA shell must keep loading with auth off over a tunnel (#S9/#S20's
  // "flagship" property) — the whole reason jurisdiction is namespace-scoped.
  it("still serves the SPA shell to an untrusted unauthenticated peer", async () => {
    const res = await fetch(url("/"), { headers: TUNNELED });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<div id=\"root\"");
  });
});

// ─── Path tricks cannot escape jurisdiction (STRIDE: Tampering) ───────────────
// Two OPPOSITE directions, and the guard must close BOTH:
//
//  1. DISGUISED ENTRY — the target resolves INTO a guarded namespace
//     (`/foo/../api/x`). Fastify hands `onRequest` the RAW target (`request.url`
//     is `raw.url`; only the `inject` helper normalizes it, via `new URL()`), so
//     the guard resolves dot-segments itself rather than depending on the router.
//  2. DISGUISED EXIT — the target resolves OUT of a guarded namespace while the
//     router still routes it. find-my-way does NOT resolve dot-segments: it
//     matches them into a `:param` / `*` slot as the literal value `..`. So
//     `DELETE /api/provider-auth/..` reaches `/api/provider-auth/:provider` with
//     `provider=".."`. Resolving alone would NO-OP this (resolved `/api` is not
//     under `/api/`) and let the handler run — a real, reproduced escape in an
//     earlier revision of this change. Guarded by a UNION over both views.
//
// These cases run over a REAL socket (raw HTTP request line) so they exercise the
// same path a hostile client would, not the inject helper's normalized one.
describe("universal guard — path tricks cannot escape jurisdiction", () => {
  /** Targets that DISGUISE AN ENTRY into a guarded namespace. */
  const DISGUISED_ENTRY = [
    "/api/evil",
    "//api/evil",
    "/foo/../api/evil",
    "/api/../api/evil",
    "/./api/evil",
    "/%2e%2e/api/evil",
    "/api/evil/../evil",
  ];
  /** Targets that DISGUISE AN EXIT — resolved out, routed in as a param value. */
  const DISGUISED_EXIT = [
    "/api/provider-auth/..",
    "/api/provider-auth/%2e%2e",
    "/api/provider-auth/.",
    "/live/x/../..",
    "/api/sessions/..",
  ];
  /**
   * Targets that abuse an in-namespace EXCEPTION while the router still routes
   * the RAW path into a wildcard namespace (round-3 finding). The resolved path
   * names a public route; the raw path matches `/live/:id/*`. Requiring the
   * exception on BOTH views is what closes these.
   */
  const EXCEPTION_SMUGGLE = [
    "/live/x/../../api/pair/challenge",
    "/live/x/../../api/pair/redeem",
    "/live/x/../../api/pair/poll",
    "/live/x/../../api/health",
  ];
  /** Encoded namespace prefix — only the raw view's decodeURI catches it. */
  const ENCODED_PREFIX = ["/%61pi/evil", "/%61%70%69/evil", "/%61pi/sessions"];

  /** Send a RAW HTTP/1.1 request line — no client-side dot-segment normalization. */
  function rawRequest(
    port: number,
    method: string,
    target: string,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        const extra = Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
        socket.write(
          `${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`,
        );
      });
      let buf = "";
      socket.on("data", (d) => {
        buf += d.toString();
      });
      socket.on("end", () => resolve({ status: Number(buf.split(" ")[1] ?? 0), body: buf }));
      socket.on("error", reject);
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error("timeout"));
      });
    });
  }

  /**
   * The real route SHAPES matter: a static path 404s for dot-segments, but a
   * `:param` or `*` route matches them. All are registered here so the test
   * would catch a regression in any direction.
   */
  async function buildRoutingApp() {
    return buildGuardApp({
      routes: (a) => {
        a.get("/api/evil", async () => ({ reached: "handler" }));
        // `:param` — the shape that swallows `..` as a value.
        a.delete("/api/provider-auth/:provider", async (req) => ({
          reached: "handler",
          provider: (req.params as { provider: string }).provider,
        }));
        // `*` — the `/live/:id/*` proxy shape (live-server-proxy.ts).
        a.all("/live/:id/*", async (req) => ({
          reached: "handler",
          id: (req.params as { id: string }).id,
          subPath: (req.params as Record<string, string>)["*"],
        }));
        a.get("/api/sessions/:id", async () => ({ reached: "handler" }));
        a.get("/api/health", async () => ({ ok: true }));
      },
    });
  }

  it("denies every DISGUISED ENTRY on a REAL socket", async () => {
    const app = await buildRoutingApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    try {
      for (const target of DISGUISED_ENTRY) {
        // The untrusted peer is simulated with a forwarding header, since the
        // request now originates from this host's loopback socket.
        const res = await rawRequest(port, "GET", target, { "x-forwarded-for": UNTRUSTED });
        expect(res.status, `${target} must not reach the handler`).toBe(403);
        expect(res.body, target).toContain("network_not_allowed");
        expect(res.body, `${target} must not have run the handler`).not.toContain("handler");
      }
    } finally {
      await app.close();
    }
  }, 30_000);

  it("denies every ENCODED namespace prefix on a REAL socket", async () => {
    // The router decodes for matching, so `/%61pi/sessions` routes to
    // `/api/sessions`; only the raw view's `decodeURI` puts it in jurisdiction.
    const app = await buildRoutingApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    try {
      for (const target of ENCODED_PREFIX) {
        const res = await rawRequest(port, "GET", target, { "x-forwarded-for": UNTRUSTED });
        expect(res.status, `${target} must be denied (raw view decodes it)`).toBe(403);
      }
    } finally {
      await app.close();
    }
  }, 30_000);

  it("denies an EXCEPTION SMUGGLED through a wildcard route", async () => {
    // Round-3 finding: with the exception judged on the resolved view only,
    // `/live/x/../../api/pair/challenge` resolved to the pairing exception and was
    // ADMITTED while the router ran `/live/:id/*` with an attacker-chosen subPath.
    const app = await buildRoutingApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    try {
      for (const target of EXCEPTION_SMUGGLE) {
        const res = await rawRequest(port, "GET", target, { "x-forwarded-for": UNTRUSTED });
        expect(res.status, `${target} must not run the wildcard handler`).toBe(403);
        expect(res.body, target).not.toContain("live-forward");
      }
      // The CLEAN exception stays reachable — requiring both views must not
      // break the legitimate public surface.
      const clean = await rawRequest(port, "GET", "/api/pair/challenge", { "x-forwarded-for": UNTRUSTED });
      expect(clean.status, "the clean pairing path is still a public exception").not.toBe(403);
      const health = await rawRequest(port, "GET", "/api/health", { "x-forwarded-for": UNTRUSTED });
      expect(health.status, "the clean health path is still public").toBe(200);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("denies every DISGUISED EXIT on a REAL socket", async () => {
    const app = await buildRoutingApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    try {
      for (const target of DISGUISED_EXIT) {
        const res = await rawRequest(port, "DELETE", target, { "x-forwarded-for": UNTRUSTED });
        expect(res.status, `${target} must be denied, not routed into a param slot`).toBe(403);
        expect(res.body, target).toContain("network_not_allowed");
        expect(res.body, `${target} must not have run the handler`).not.toContain("handler");
      }
    } finally {
      await app.close();
    }
  }, 30_000);

  it("still no-ops a genuinely out-of-jurisdiction dotted path", async () => {
    const app = await buildRoutingApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    try {
      const spa = await rawRequest(port, "GET", "/foo/../settings", { "x-forwarded-for": UNTRUSTED });
      expect(spa.status, "/settings is out of jurisdiction").not.toBe(403);
    } finally {
      await app.close();
    }
  }, 30_000);

  it("resolves dot-segments for the resolved view, and keeps a raw view", () => {
    // The RESOLVED view: the request's true target, used for the exceptions.
    expect(guardPathname("/foo/../api/evil")).toBe("/api/evil");
    expect(guardPathname("/api/../api/evil")).toBe("/api/evil");
    expect(guardPathname("/./api/evil")).toBe("/api/evil");
    expect(guardPathname("/%2e%2e/api/evil")).toBe("/api/evil");
    expect(guardPathname("/api/evil/../evil")).toBe("/api/evil");
    // RFC 3986: `/a/../` is `/`, not `//`.
    expect(guardPathname("/a/../")).toBe("/");
    expect(guardPathname("/api/evil/..")).toBe("/api");
    // Non-dot paths are unaffected — including a segment that merely CONTAINS dots.
    expect(guardPathname("/api/sessions")).toBe("/api/sessions");
    expect(guardPathname("/api/file/foo.bar.ts")).toBe("/api/file/foo.bar.ts");
    expect(guardPathname("/api/file/...")).toBe("/api/file/...");
    expect(guardPathname("/")).toBe("/");
  });

  it("still treats a DOTTED out-of-jurisdiction path as a no-op (no over-deny)", async () => {
    // Found on the real harness: a blanket "any dot-segment fails closed" rule
    // denied `GET /foo/../settings` (an SPA fallback path) with 403, violating
    // "outside jurisdiction it does nothing". The union rule fixes that while
    // keeping both escape directions denied.
    //
    // NOTE for a future reader: in the FULL server `GET /foo/../settings` still
    // answers 403 — that is `@fastify/static`'s own traversal protection (proven
    // with a trust-any guard where the guard cannot deny), layered on top and
    // pre-existing. It is NOT this guard, and this guard must stay a no-op here.
    const app = await buildGuardApp({
      routes: (a) => {
        a.get("/settings", async () => ({ spaLanding: true }));
      },
    });
    const res = await app.inject({ method: "GET", url: "/foo/../settings", remoteAddress: UNTRUSTED });
    await app.close();
    expect(res.statusCode, "/settings is out of jurisdiction").not.toBe(403);
  });
});

// ─── The denial log never carries a credential (STRIDE: Info disclosure) ──────
// The log contracts on path + ip + reason ONLY. The unparseable branch cannot
// strip the query via `guardPathname` (that is what failed), so it must strip it
// explicitly — otherwise `/api/%zz?token=…` writes a credential into server.log.
describe("universal guard — denial log hygiene", () => {
  function captureReply() {
    return {
      status: undefined as number | undefined,
      code(c: number) {
        this.status = c;
        return this;
      },
      send() {
        return this;
      },
    };
  }

  it("strips the query string on the unparseable (fail-closed) branch", async () => {
    const logged: GuardDenialLogEntry[] = [];
    const hook = createNetworkGuardHook({ trustedNetworks: [], logDenial: (e) => logged.push(e) });
    await hook(
      { url: "/api/%zz?token=super-secret-token", method: "GET", ip: UNTRUSTED, headers: {} } as never,
      captureReply() as never,
    );
    expect(logged).toHaveLength(1);
    expect(logged[0].reason).toBe(GUARD_DENY_REASON.unparseableUrl);
    expect(logged[0].path).toBe("/api/%zz");
    expect(JSON.stringify(logged)).not.toContain("super-secret-token");
  });

  it("bounds an over-long unparseable target", async () => {
    const logged: GuardDenialLogEntry[] = [];
    const hook = createNetworkGuardHook({ trustedNetworks: [], logDenial: (e) => logged.push(e) });
    await hook(
      { url: `/api/%zz${"a".repeat(5000)}`, method: "GET", ip: UNTRUSTED, headers: {} } as never,
      captureReply() as never,
    );
    expect(logged[0].path.length).toBeLessThanOrEqual(200);
  });

  it("logs the query-stripped pathname on the normal deny path", async () => {
    const logged: GuardDenialLogEntry[] = [];
    const app = await buildGuardApp({ logDenial: (e) => logged.push(e) });
    await app.inject({
      method: "GET",
      url: "/api/sessions?token=super-secret-token",
      remoteAddress: UNTRUSTED,
    });
    await app.close();
    expect(logged[0].path).toBe("/api/sessions");
    expect(JSON.stringify(logged)).not.toContain("super-secret-token");
  });
});

// ─── One denial is one log line (STRIDE: Tampering / Repudiation) ─────────────
// `guardPathname` returns a `decodeURI`-DECODED pathname, so `%0a`/`%0d` in a
// target becomes a real newline. Left unsanitized, a caller could inject
// counterfeit `[network-guard] denied …` lines into server.log — hiding a real
// probe or manufacturing a fake one. Found by the step-4.5 reviewer.
describe("universal guard — denial log cannot be forged or bloated", () => {
  it("strips an injected CR/LF from a decoded pathname", async () => {
    const logged: GuardDenialLogEntry[] = [];
    const app = await buildGuardApp({ logDenial: (e) => logged.push(e) });
    // Encoded newline + bracketed forgery payload, so the request line stays valid.
    await app.inject({
      method: "GET",
      url: "/api/x%0a%5Bnetwork-guard%5D%20denied%20reason=fake%20path=/x%20ip=1.2.3.4",
      remoteAddress: UNTRUSTED,
    });
    await app.close();

    expect(logged).toHaveLength(1);
    expect(logged[0].path, "a newline would forge a second log line").not.toMatch(/[\r\n]/);
    expect(logged[0].path).not.toContain("\n");
    // The real path is still recorded, so the log stays useful.
    expect(logged[0].path.startsWith("/api/x")).toBe(true);
  });

  it("bounds an over-long decoded pathname", async () => {
    const logged: GuardDenialLogEntry[] = [];
    const app = await buildGuardApp({ logDenial: (e) => logged.push(e) });
    await app.inject({
      method: "GET",
      url: `/api/${"a".repeat(4000)}`,
      remoteAddress: UNTRUSTED,
    });
    await app.close();
    expect(logged[0].path.length).toBeLessThanOrEqual(200);
  });

  it("applies the same hygiene when no sink is injected (default sink path)", async () => {
    // The default sink must not be relied on to clean: sanitization happens at
    // the emit site, so BOTH the default and an injected sink get safe fields.
    const app = await buildGuardApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/x%0d%0a%5Bnetwork-guard%5D%20denied%20reason=fake",
      remoteAddress: UNTRUSTED,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
