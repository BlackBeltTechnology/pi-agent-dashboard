/**
 * Session tier claim + OIDC group → tier map.
 * See change: add-passkey-user-auth (oauth-authentication › Session tier claim,
 * › OIDC groups map to a tier; tasks 2.4, 2.5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const userInfo = vi.fn(async () => ({ email: "u@example.com", name: "U", username: "u", groups: [] as string[] }));
const tokens = vi.fn(async (): Promise<{ accessToken: string; idToken?: string }> => ({ accessToken: "access-token" }));
vi.mock("../auth/auth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/auth.js")>()),
  exchangeCode: (...a: unknown[]) => (tokens as any)(...a),
  fetchUserInfo: (...a: unknown[]) => (userInfo as any)(...a),
}));

import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { idTokenGroups, resolveGroupTier, signToken, verifyToken } from "../auth/auth.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";

const SECRET = "test-secret-32-chars-long-abcdef";
const REMOTE = "203.0.113.5";
const github = { github: { clientId: "cid", clientSecret: "cs" } };

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  userInfo.mockReset();
  tokens.mockReset();
  tokens.mockResolvedValue({ accessToken: "access-token" });
});

/** Unsigned-looking JWT (back-channel id_token; claims only are read). */
const idToken = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

async function makeApp(extra: Partial<AuthConfig> = {}): Promise<FastifyInstance> {
  const a = Fastify();
  await registerAuthPlugin(a, {
    authConfig: { secret: SECRET, providers: github, ...extra } as AuthConfig,
    port: 8000,
  });
  a.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
  a.post("/api/restart", async () => ({ ok: true }));
  a.get("/api/sessions", async () => ({ ok: true }));
  await a.ready();
  return a;
}

const cookieFor = (tier?: "observe" | "control" | "operate") =>
  `pi_dash_token=${signToken({ sub: "a@x", name: "A", username: "a", provider: "github", ...(tier ? { tier } : {}) }, SECRET)}`;

describe("JWT tier claim", () => {
  it("signToken carries tier only when given", () => {
    expect(verifyToken(cookieFor("observe").split("=")[1]!, SECRET)?.tier).toBe("observe");
    expect(verifyToken(cookieFor().split("=")[1]!, SECRET)?.tier).toBeUndefined();
  });
});

describe("session tier gate (2.4)", () => {
  it("observe JWT is refused on an operate route", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/restart", remoteAddress: REMOTE, headers: { cookie: cookieFor("observe") } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
  });

  it("observe JWT may read an observe route", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/api/sessions", remoteAddress: REMOTE, headers: { cookie: cookieFor("observe") } });
    expect(res.statusCode).toBe(200);
  });

  it("legacy JWT without a tier keeps full access", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/restart", remoteAddress: REMOTE, headers: { cookie: cookieFor() } });
    expect(res.statusCode).toBe(200);
  });

  it("an invalid tier claim is not trusted (treated as unauthenticated)", async () => {
    app = await makeApp();
    const forged = jwt.sign({ sub: "a@x", name: "A", username: "a", provider: "github", tier: "root" }, SECRET);
    const res = await app.inject({ method: "POST", url: "/api/restart", remoteAddress: REMOTE, headers: { cookie: `pi_dash_token=${forged}` } });
    expect(res.statusCode).toBe(401);
  });

  it("loopback is unaffected by an observe cookie", async () => {
    app = await makeApp();
    const res = await app.inject({ method: "POST", url: "/api/restart", remoteAddress: "127.0.0.1", headers: { cookie: cookieFor("observe") } });
    expect(res.statusCode).toBe(200);
  });
});

describe("resolveGroupTier (2.5)", () => {
  const map = { "dash-view": "observe", "dash-ops": "operate", "dash-ctl": "control" } as const;
  it("highest matching group wins", () => {
    expect(resolveGroupTier(["dash-view", "dash-ops"], map)).toBe("operate");
    expect(resolveGroupTier(["dash-ctl", "dash-view"], map)).toBe("control");
  });
  it("no match is refused (null)", () => {
    expect(resolveGroupTier(["other"], map)).toBeNull();
    expect(resolveGroupTier(undefined, map)).toBeNull();
  });
  it("unconfigured map yields operate", () => {
    expect(resolveGroupTier(["anything"], undefined)).toBe("operate");
    expect(resolveGroupTier(undefined, {})).toBe("operate");
  });
});

describe("idTokenGroups", () => {
  it("reads groups when aud matches the client (string or array aud)", () => {
    expect(idTokenGroups(idToken({ aud: "cid", groups: ["a", 1, "b"] }), "cid")).toEqual(["a", "b"]);
    expect(idTokenGroups(idToken({ aud: ["x", "cid"], groups: ["a"] }), "cid")).toEqual(["a"]);
  });
  it("ignores a token for another audience, malformed tokens, and absent groups", () => {
    expect(idTokenGroups(idToken({ aud: "other", groups: ["a"] }), "cid")).toBeUndefined();
    expect(idTokenGroups("not-a-jwt", "cid")).toBeUndefined();
    expect(idTokenGroups(idToken({ aud: "cid" }), "cid")).toBeUndefined();
    expect(idTokenGroups(undefined, "cid")).toBeUndefined();
  });
});

describe("OIDC callback group mapping (2.5)", () => {
  async function login(a: FastifyInstance) {
    const start = await a.inject({ method: "GET", url: "/auth/login" });
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    const cookie = ([] as string[]).concat(start.headers["set-cookie"] ?? []).find((c) => c.startsWith("pi_dash_oauth_state="))!.split(";")[0]!;
    return a.inject({ method: "GET", url: `/auth/callback/github?code=c&state=${state}`, headers: { cookie } });
  }
  const tokenOf = (res: { headers: Record<string, any> }) => {
    const c = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((x) => x.startsWith("pi_dash_token="));
    return c ? verifyToken(c.split(";")[0]!.split("=")[1]!, SECRET) : null;
  };

  it("issues the highest matching tier", async () => {
    userInfo.mockResolvedValue({ email: "u@example.com", name: "U", username: "u", groups: ["dash-view", "dash-ops"] });
    app = await makeApp({ groupTiers: { "dash-view": "observe", "dash-ops": "operate" } });
    const res = await login(app);
    expect(res.statusCode).toBe(302);
    expect(tokenOf(res)?.tier).toBe("operate");
  });

  it("refuses login when no group matches", async () => {
    userInfo.mockResolvedValue({ email: "u@example.com", name: "U", username: "u", groups: ["nope"] });
    app = await makeApp({ groupTiers: { "dash-view": "observe" } });
    const res = await login(app);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Access Denied");
    expect(tokenOf(res)).toBeNull();
  });

  it("groups carried only in the ID token are honoured (e.g. Keycloak default mapper)", async () => {
    tokens.mockResolvedValue({ accessToken: "access-token", idToken: idToken({ aud: "cid", groups: ["dash-ops"] }) });
    userInfo.mockResolvedValue({ email: "u@example.com", name: "U", username: "u" } as any);
    app = await makeApp({ groupTiers: { "dash-ops": "operate" } });
    const res = await login(app);
    expect(res.statusCode).toBe(302);
    expect(tokenOf(res)?.tier).toBe("operate");
  });

  it("ID-token and userinfo groups are merged; highest wins", async () => {
    tokens.mockResolvedValue({ accessToken: "access-token", idToken: idToken({ aud: "cid", groups: ["dash-view"] }) });
    userInfo.mockResolvedValue({ email: "u@example.com", name: "U", username: "u", groups: ["dash-ctl"] });
    app = await makeApp({ groupTiers: { "dash-view": "observe", "dash-ctl": "control" } });
    expect(tokenOf(await login(app))?.tier).toBe("control");
  });

  it("unconfigured map keeps legacy behaviour with tier operate", async () => {
    userInfo.mockResolvedValue({ email: "u@example.com", name: "U", username: "u", groups: [] });
    app = await makeApp();
    const res = await login(app);
    expect(res.statusCode).toBe(302);
    expect(tokenOf(res)?.tier).toBe("operate");
  });
});
