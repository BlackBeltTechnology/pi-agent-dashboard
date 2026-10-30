/**
 * Login OAuth CSRF + open-redirect hardening.
 * See change: harden-trust-and-credential-boundaries (D0/D1; T-E1..E4, X1..X4).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn(async () => ({ accessToken: "access-token" }));
vi.mock("../auth/auth.js", async (orig) => ({
  ...(await orig<typeof import("../auth/auth.js")>()),
  exchangeCode: (...a: unknown[]) => (exchange as any)(...a),
  fetchUserInfo: async () => ({ email: "u@example.com", name: "U", username: "u" }),
}));

// Live-tunnel stub for the B16r `Secure` predicate (AE21, AX9): default = no tunnel,
// i.e. identical to the real module with nothing connected.
// See change: harden-auth-credentials (D3).
const tunnel = { urls: [] as string[] };
vi.mock("../tunnel/tunnel.js", async (orig) => ({
  ...(await orig<typeof import("../tunnel/tunnel.js")>()),
  getTunnelUrl: () => tunnel.urls[0] ?? null,
  liveTunnelOrigins: () => tunnel.urls,
}));

import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { registerAuthPlugin, sanitizeReturnUrl } from "../auth/auth-plugin.js";
import { isSecureOrigin } from "../auth/secure-origin.js";

const SECRET = "test-secret-32-chars-long-abcdef";

async function makeApp(providers: AuthConfig["providers"], redirectBaseUrl?: string) {
  const { default: Fastify } = await import("fastify");
  const app = Fastify();
  await registerAuthPlugin(app, {
    authConfig: { secret: SECRET, providers, allowedUsers: ["*@example.com", "*@x"], ...(redirectBaseUrl ? { redirectBaseUrl } : {}) } as AuthConfig,
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
  tunnel.urls = [];
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

// See change: fix-pairing-approval-credential (test-plan E20–E23): the one return-path predicate,
// also used by `GET /auth/local-proof?next=`.
describe("sanitizeReturnUrl — shared same-origin predicate (E20–E23)", () => {
  it.each(["/settings/gateway", "/a?b=c#d", "/%2F%2Fevil.example", "/..//evil", "/a\u0020", "/a\u0080"])(
    "E20/E22 keeps same-origin %j unchanged",
    (v) => expect(sanitizeReturnUrl(v)).toBe(v),
  );

  it.each<unknown>([
    "https://evil.example/steal",
    "//evil.example",
    "/\\evil.example",
    "evil",
    "",
    undefined,
    123,
    ["/a"],
    "HTTPS://evil",
    "/\\/evil",
  ])("E21 off-origin / non-string %j → /", (v) => expect(sanitizeReturnUrl(v)).toBe("/"));

  it.each(["/\t/evil.example", "/\r\n/evil.example", "/\r\nSet-Cookie: x=y", "/a\u0000", "/a\u001f", "/a\u007f"])(
    "E22 control character %j → /",
    (v) => expect(sanitizeReturnUrl(v)).toBe("/"),
  );

  it("E23 exactly one definition, imported by local-proof-routes.ts", () => {
    const root = path.resolve(__dirname, "..");
    const defs: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__" && e.name !== "node_modules") walk(full);
        } else if (/\.tsx?$/.test(e.name) && /\b(?:function|const|let)\s+sanitizeReturnUrl\b/.test(fs.readFileSync(full, "utf8"))) {
          defs.push(path.relative(root, full));
        }
      }
    };
    walk(root);
    expect(defs).toHaveLength(1);
    const routes = fs.readFileSync(path.join(root, "routes", "local-proof-routes.ts"), "utf8");
    expect(routes).toMatch(/import\s*\{[^}]*\bsanitizeReturnUrl\b[^}]*\}\s*from\s*"\.\.\/auth\//);
    expect(routes).toMatch(/sanitizeReturnUrl\(/);
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

// ─── B16r: `Secure` on the state + session cookies (AE13, AE21, AX9) ────────
// See change: harden-auth-credentials (D3).

describe("B16r: cookie Secure decision table (AE13)", () => {
  /** Run /auth/start/github then the OAuth callback; return both Set-Cookie attributes. */
  async function flow(opts: { base: string; peer: string; tls?: boolean; headers?: Record<string, string> }) {
    const { default: Fastify } = await import("fastify");
    const a = Fastify();
    if (opts.tls) {
      // light-my-request builds the socket; mark it TLS the way node:tls does.
      a.addHook("onRequest", async (r) => {
        (r.raw.socket as unknown as { encrypted: boolean }).encrypted = true;
      });
    }
    await registerAuthPlugin(a, {
      authConfig: { secret: SECRET, providers: github, allowedUsers: ["*@example.com", "*@x"], redirectBaseUrl: opts.base } as AuthConfig,
      port: 8000,
    });
    await a.ready();
    try {
      const headers = opts.headers ?? {};
      const start = await a.inject({ method: "GET", url: "/auth/start/github", remoteAddress: opts.peer, headers });
      const state = new URL(start.headers.location as string).searchParams.get("state")!;
      const sc = stateCookie(start);
      const cb = await a.inject({
        method: "GET",
        url: `/auth/callback/github?code=c&state=${state}`,
        remoteAddress: opts.peer,
        headers: { ...headers, cookie: sc.split(";")[0]! },
      });
      const token = setCookies(cb).find((c) => c.startsWith("pi_dash_token="));
      return { stateCookie: sc, tokenCookie: token };
    } finally {
      await a.close();
    }
  }
  const secure = (c: string | undefined) => /;\s*Secure/i.test(c ?? "");

  it.each([
    ["203.0.113.9", "external"],
    ["127.0.0.1", "loopback"],
  ])("AE13 rows (a)–(d), %s peer", async (peer) => {
    // (a) https base, plain-http hop → Secure
    const a = await flow({ base: "https://pi.example.com", peer });
    expect(secure(a.stateCookie)).toBe(true);
    expect(secure(a.tokenCookie)).toBe(true);
    // (b) http base, TLS socket → Secure
    const b = await flow({ base: "http://pi.internal", peer, tls: true });
    expect(secure(b.stateCookie)).toBe(true);
    expect(secure(b.tokenCookie)).toBe(true);
    // (c) http base, plain http → not Secure
    const c = await flow({ base: "http://pi.internal", peer });
    expect(c.tokenCookie).toBeDefined();
    expect(secure(c.stateCookie)).toBe(false);
    expect(secure(c.tokenCookie)).toBe(false);
    // (d) http base, plain http + X-Forwarded-Proto: https → still not Secure (headers never decide)
    const d = await flow({ base: "http://pi.internal", peer, headers: { "x-forwarded-proto": "https" } });
    expect(d.tokenCookie).toBeDefined();
    expect(secure(d.stateCookie)).toBe(false);
    expect(secure(d.tokenCookie)).toBe(false);
  });

  it("B16r a live https tunnel Host from a loopback peer also makes the session cookie Secure", async () => {
    tunnel.urls = ["https://pi.share.example"];
    const r = await flow({ base: "http://pi.internal", peer: "127.0.0.1", headers: { host: "pi.share.example" } });
    expect(secure(r.stateCookie)).toBe(true);
    expect(secure(r.tokenCookie)).toBe(true);
  });
});

describe("B16r: pi_dash_local is unchanged by the predicate (AE21)", () => {
  it("AE21 live https tunnel + matching Host: pi_dash_local has no Secure attribute", async () => {
    const { default: Fastify } = await import("fastify");
    const fastifyCookie = (await import("@fastify/cookie")).default;
    const { createLocalTrustContext, LocalProofCodeStore } = await import("../auth/local-proof.js");
    const { registerLocalProofRoutes } = await import("../routes/local-proof-routes.js");
    tunnel.urls = ["https://pi.share.example"];
    const codes = new LocalProofCodeStore(() => 1_000_000);
    const a = Fastify();
    await a.register(fastifyCookie);
    registerLocalProofRoutes(a, { codes, ctx: createLocalTrustContext("local-token-ae21", () => false) });
    await a.ready();
    const res = await a.inject({
      method: "GET",
      url: `/auth/local-proof?code=${codes.mint()}`,
      remoteAddress: "127.0.0.1",
      headers: { host: "pi.share.example" },
    });
    await a.close();
    const c = setCookies(res).find((x) => x.startsWith("pi_dash_local="))!;
    expect(c).toBeDefined();
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).not.toMatch(/;\s*Secure/i);
  });
});

describe("B16r: malformed / hostile Host never breaks the predicate (AX9)", () => {
  const HOSTS = ["", "[", "pi.share.example:abc", "pi.share.example:99999", "pi.share.example:443:443", "pi.share.example@evil.test", "pi.share.example/x"];

  it.each(HOSTS)("AX9 isSecureOrigin(Host=%j) is false and does not throw", (host) => {
    tunnel.urls = ["https://pi.share.example"];
    const fake = { raw: { socket: { remoteAddress: "127.0.0.1" } }, headers: { host } } as never;
    let out: boolean | undefined;
    expect(() => {
      out = isSecureOrigin(fake, false);
    }).not.toThrow();
    expect(out).toBe(false);
  });

  it("AX9 end to end: state-cookie request per hostile Host → 302, cookie lacks Secure", async () => {
    tunnel.urls = ["https://pi.share.example"];
    app = await makeApp(github, "http://pi.internal");
    for (const host of HOSTS) {
      const res = await app.inject({ method: "GET", url: "/auth/start/github", remoteAddress: "127.0.0.1", headers: { host } });
      expect(res.statusCode, `Host ${JSON.stringify(host)}`).toBe(302);
      expect(stateCookie(res), `Host ${JSON.stringify(host)}`).not.toMatch(/;\s*Secure/i);
    }
  });
});
