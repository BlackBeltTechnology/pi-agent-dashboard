/**
 * The remedy for a browser the strict default refuses: `/api/health` says
 * `localProof: "required"` only to a bare-loopback caller, a signed-in loopback
 * tab is recognised on observe routes, and `/auth/login` shows the remedy instead
 * of bouncing that tab to a provider.
 *
 * See change: close-container-loopback-impersonation (D3; test-plan #E7, #E8, #E9).
 */
import fs from "node:fs";
import path from "node:path";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signToken } from "../auth/auth.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";
import { createLocalTrustContext, LOCAL_PROOF_COOKIE, signLocalProof } from "../auth/local-proof.js";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

const SECRET = "test-secret-32-chars-long-abcdef";
const github = { github: { clientId: "cid", clientSecret: "cs" } };
const session = () => `pi_dash_token=${signToken({ sub: "a@x", name: "A", username: "a", provider: "github" }, SECRET)}`;
const expired = () =>
  `pi_dash_token=${jwt.sign({ sub: "a@x", name: "A", username: "a", provider: "github" }, SECRET, { expiresIn: -10 })}`;

describe("E7 — /api/health localProof only for a bare-loopback caller (real server)", () => {
  let handle: TestServerHandle | undefined;
  let dash: string;
  beforeEach(() => {
    dash = path.join(process.env.HOME!, ".pi", "dashboard");
    fs.mkdirSync(dash, { recursive: true });
  });
  afterEach(async () => {
    if (handle) await handle.stop();
    handle = undefined;
    fs.rmSync(path.join(dash, "config.json"), { force: true });
    resetConfigSnapshot();
  });

  const health = async (init: RequestInit = {}, viaProof = false) => {
    const url = `http://127.0.0.1:${handle!.httpPort}/api/health`;
    const res = await (viaProof ? proofFetch(url, init) : fetch(url, init));
    expect(res.status).toBe(200);
    return (await res.json()) as { localProof?: string };
  };

  it("present for bare loopback; absent for proofed, forwarded, signed-in, device-bearer and opted-out callers", async () => {
    fs.writeFileSync(path.join(dash, "config.json"), JSON.stringify({}), { mode: 0o600 });
    resetConfigSnapshot();
    handle = await createTestServer({
      authConfig: { secret: SECRET, providers: github } as AuthConfig,
    });

    // 1. bare loopback → told to authorize
    expect((await health()).localProof).toBe("required");
    // 2. loopback + proof → no field
    expect((await health({}, true)).localProof).toBeUndefined();
    // 3. not genuinely local (forwarding header), no session → no field (a different remedy applies)
    expect((await health({ headers: { "x-forwarded-for": "203.0.113.9" } })).localProof).toBeUndefined();
    // 4. loopback + valid session cookie → recognised, no field
    expect((await health({ headers: { cookie: session() } })).localProof).toBeUndefined();
    // 5. loopback + device bearer → authenticated, no field
    const mint = await proofFetch(`http://127.0.0.1:${handle.httpPort}/api/paired-devices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "e7" }),
    });
    const token = ((await mint.json()) as { data: { token: string } }).data.token;
    expect((await health({ headers: { authorization: `Bearer ${token}` } })).localProof).toBeUndefined();
    // 6. opt-out, bare loopback → no field (the strict default is off)
    fs.writeFileSync(path.join(dash, "config.json"), JSON.stringify({ requireLocalProof: false }), { mode: 0o600 }); // explicit opt-out
    resetConfigSnapshot();
    expect((await health()).localProof).toBeUndefined();
  }, 40000);
});

describe("E8 — a valid session is recognised on observe routes under strict; an expired one is not cleared", () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  async function makeApp(): Promise<FastifyInstance> {
    const a = Fastify();
    await a.register(fastifyCookie);
    await registerAuthPlugin(a, {
      authConfig: { secret: SECRET, providers: github } as AuthConfig,
      port: 8000,
      localToken: "tok",
      localTrust: createLocalTrustContext("tok", () => true),
    });
    const probe = async (request: { isAuthenticated?: boolean; authVia?: string }) => ({
      authenticated: request.isAuthenticated === true,
      authVia: request.authVia ?? null,
    });
    a.get("/api/sessions", probe as never);
    a.get("/api/health", probe as never);
    await a.ready();
    return a;
  }
  const get = (a: FastifyInstance, url: string, cookie?: string) =>
    a.inject({ method: "GET", url, remoteAddress: "127.0.0.1", headers: cookie ? { cookie } : {} });

  it("valid cookie: authenticated via session on /api/sessions and /api/health", async () => {
    app = await makeApp();
    for (const url of ["/api/sessions", "/api/health"]) {
      const res = await get(app, url, session());
      expect(res.statusCode, url).toBe(200);
      expect(res.json(), url).toEqual({ authenticated: true, authVia: "session" });
    }
  });

  it("expired cookie: unauthenticated, and NO clearing Set-Cookie on these observe routes", async () => {
    app = await makeApp();
    for (const url of ["/api/sessions", "/api/health"]) {
      const res = await get(app, url, expired());
      expect(res.statusCode, url).toBe(200);
      expect(res.json(), url).toEqual({ authenticated: false, authVia: null });
      expect(([] as string[]).concat((res.headers["set-cookie"] as string[] | string | undefined) ?? []).filter((c) => c.startsWith("pi_dash_token=")), url).toEqual([]);
    }
  });
});

describe("E9 — /auth/login: a bare-loopback tab sees the remedy, not a provider redirect", () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    await app?.close();
    app = null;
  });
  const ctx = createLocalTrustContext("tok", () => true);

  async function makeApp(): Promise<FastifyInstance> {
    const a = Fastify();
    await a.register(fastifyCookie);
    await registerAuthPlugin(a, { authConfig: { secret: SECRET, providers: github } as AuthConfig, port: 8000, localToken: "tok", localTrust: ctx });
    await a.ready();
    return a;
  }
  const login = (a: FastifyInstance, remoteAddress: string, headers: Record<string, string> = {}) =>
    a.inject({ method: "GET", url: "/auth/login", remoteAddress, headers: { accept: "text/html", ...headers } });

  it("bare loopback → 200 picker with `pi-dashboard open`, no Location", async () => {
    app = await makeApp();
    const res = await login(app, "127.0.0.1");
    expect(res.statusCode).toBe(200);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).toContain("pi-dashboard open");
  });

  it("loopback + proof cookie and a non-loopback caller → 302 to the provider", async () => {
    app = await makeApp();
    const proofed = await login(app, "127.0.0.1", { cookie: `${LOCAL_PROOF_COOKIE}=${signLocalProof(ctx)}` });
    expect(proofed.statusCode).toBe(302);
    expect(String(proofed.headers.location)).toContain("github.com");
    const remote = await login(app, "203.0.113.7");
    expect(remote.statusCode).toBe(302);
    expect(remote.body).not.toContain("pi-dashboard open");
  });
});
