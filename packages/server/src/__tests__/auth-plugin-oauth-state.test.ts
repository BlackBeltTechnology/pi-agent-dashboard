/**
 * Login OAuth CSRF + open-redirect hardening.
 * See change: harden-trust-and-credential-boundaries (D0/D1; T-E1..E4, X1..X4).
 */
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn(async () => "access-token");
vi.mock("../auth/auth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/auth.js")>()),
  exchangeCode: (...a: unknown[]) => (exchange as any)(...a),
  fetchUserInfo: async () => ({ email: "u@example.com", name: "U", username: "u" }),
}));

import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { registerAuthPlugin, sanitizeReturnUrl } from "../auth/auth-plugin.js";

const SECRET = "test-secret-32-chars-long-abcdef";

async function makeApp(providers: AuthConfig["providers"], redirectBaseUrl?: string) {
  const { default: Fastify } = await import("fastify");
  const app = Fastify();
  await registerAuthPlugin(app, {
    authConfig: { secret: SECRET, providers, ...(redirectBaseUrl ? { redirectBaseUrl } : {}) } as AuthConfig,
    port: 8000,
  });
  await app.ready();
  return app;
}
const github = { github: { clientId: "cid", clientSecret: "cs" } };
const both = { ...github, google: { clientId: "g", clientSecret: "gs" } } as unknown as AuthConfig["providers"];

let app: Awaited<ReturnType<typeof makeApp>> | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
  exchange.mockClear();
});

const stateOf = (loc: string) => JSON.parse(Buffer.from(new URL(loc).searchParams.get("state")!, "base64url").toString());
const setCookies = (res: { headers: Record<string, any> }) => ([] as string[]).concat(res.headers["set-cookie"] ?? []);
const stateCookie = (res: { headers: Record<string, any> }) => setCookies(res).find((c) => c.startsWith("pi_dash_oauth_state="))!;

describe("sanitizeReturnUrl", () => {
  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/a\nb", ""])("rejects %j", (v) => {
    expect(sanitizeReturnUrl(v)).toBe("/");
  });
  it("keeps same-origin paths; %252F stays literal", () => {
    expect(sanitizeReturnUrl("/sessions?x=1")).toBe("/sessions?x=1");
    expect(sanitizeReturnUrl("%252F%252Fevil.example")).toBe("/");
    expect(sanitizeReturnUrl("/")).toBe("/");
  });
});

describe("login redirect (E1-E4)", () => {
  it("E1 constrains return into state", async () => {
    app = await makeApp(github);
    for (const [ret, want] of [["https://evil.example/x", "/"], ["//evil.example", "/"], ["/\\evil.example", "/"], ["%252F%252Fevil.example", "/"], ["javascript:alert(1)", "/"], ["/sessions?x=1", "/sessions?x=1"], ["/", "/"]] as const) {
      const res = await app.inject({ method: "GET", url: `/auth/login?return=${encodeURIComponent(ret)}` });
      expect(res.statusCode).toBe(302);
      expect(stateOf(res.headers.location as string).returnUrl).toBe(want);
    }
  });

  it("E2 state cookie attributes; Secure only for https base", async () => {
    app = await makeApp(github);
    const http = stateCookie(await app.inject({ method: "GET", url: "/auth/login" }));
    expect(http).toMatch(/HttpOnly/i);
    expect(http).toMatch(/SameSite=Lax/i);
    expect(http).toMatch(/Path=\/auth\//);
    expect(http).toMatch(/Max-Age=600/);
    expect(http).not.toMatch(/Secure/i);
    await app.close();
    app = await makeApp(github, "https://pi.example.com");
    expect(stateCookie(await app.inject({ method: "GET", url: "/auth/login" }))).toMatch(/Secure/i);
  });

  it("E3 cookie MAC uses the domain-separated key", async () => {
    app = await makeApp(github);
    const raw = decodeURIComponent(stateCookie(await app.inject({ method: "GET", url: "/auth/login" })).split(";")[0]!.split("=")[1]!);
    const [nonce, mac] = raw.split(".");
    const k = crypto.createHmac("sha256", SECRET).update("pi-dashboard/oauth-state/v1").digest();
    expect(mac).toBe(crypto.createHmac("sha256", k).update(nonce!).digest("hex"));
    expect(mac).not.toBe(crypto.createHmac("sha256", SECRET).update(nonce!).digest("hex"));
  });

  it("E4 picker links carry the sanitized return", async () => {
    app = await makeApp(both);
    const a = await app.inject({ method: "GET", url: "/auth/login?return=/sessions" });
    expect(a.body).toContain("?return=%2Fsessions");
    const b = await app.inject({ method: "GET", url: `/auth/login?return=${encodeURIComponent("//evil.example")}` });
    expect(b.body).toContain("?return=%2F\"");
    expect(b.body).not.toContain("evil.example");
  });
});

describe("callback state verification (X1-X4)", () => {
  async function start(returnUrl = "/") {
    const res = await app!.inject({ method: "GET", url: `/auth/login?return=${encodeURIComponent(returnUrl)}` });
    return { state: new URL(res.headers.location as string).searchParams.get("state")!, cookie: stateCookie(res).split(";")[0]! };
  }
  const cb = (state: string, cookie?: string) =>
    app!.inject({ method: "GET", url: `/auth/callback/github?code=c&state=${state}`, headers: cookie ? { cookie } : {} });
  const bad = (res: Awaited<ReturnType<typeof cb>>) => {
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/auth/login?error=Invalid+login+state");
    expect(exchange).not.toHaveBeenCalled();
    expect(setCookies(res).some((c) => c.startsWith("pi_dash_token="))).toBe(false);
    expect(setCookies(res).some((c) => /^pi_dash_oauth_state=;/.test(c) || /pi_dash_oauth_state=;/.test(c))).toBe(true);
  };

  it("X1 mismatched nonce", async () => {
    app = await makeApp(github);
    const a = await start();
    const b = await start();
    bad(await cb(a.state, b.cookie));
  });
  it("X2 missing cookie", async () => {
    app = await makeApp(github);
    bad(await cb((await start()).state));
  });
  it("X3 tampered MAC", async () => {
    app = await makeApp(github);
    const { state, cookie } = await start();
    const tampered = cookie.slice(0, -1) + (cookie.endsWith("0") ? "1" : "0");
    bad(await cb(state, tampered));
  });
  it("X4 happy path", async () => {
    app = await makeApp(github);
    const { state, cookie } = await start("/sessions");
    const res = await cb(state, cookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/sessions");
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(setCookies(res).some((c) => c.startsWith("pi_dash_token="))).toBe(true);
    expect(setCookies(res).some((c) => /pi_dash_oauth_state=;/.test(c))).toBe(true);
  });
});
