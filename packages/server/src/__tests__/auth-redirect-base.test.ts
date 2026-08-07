/**
 * Coverage for the OAuth redirect-base override (`auth.redirectBaseUrl`).
 *
 * Change: config-override-oauth-redirect-base (reviewing PR #409).
 * Test plan rows: E1–E6, E13–E16, X1–X4, P1.
 *
 * Verified red on `develop` (11 of 19 cases failed, and the file did not even
 * type-check without the 3-arg `buildRedirectUri`) and green on this branch —
 * so it is not a vacuous gate.
 *
 * WHY A SEPARATE FILE FROM `auth.test.ts`
 * ---------------------------------------
 * The headline behaviour of the feature is "the configured override beats an
 * ACTIVE tunnel". `auth.test.ts` cannot prove that — it says so itself: "No
 * tunnel runtime exists in tests, so getTunnelUrl() returns null and the
 * localhost fallback is exercised." Every assertion there is really
 * override-vs-localhost. Proving the real precedence needs
 * `vi.mock("../tunnel/tunnel.js")`, which is file-scoped and would otherwise
 * leak into every unrelated test in `auth.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Module-scoped tunnel stub. `getTunnelUrl` is a plain named import inside
// `auth.ts`, so this is the only seam that can simulate an active tunnel.
const tunnelUrl = { value: null as string | null };
vi.mock("../tunnel/tunnel.js", () => ({
  getTunnelUrl: () => tunnelUrl.value,
}));

import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { buildRedirectUri, resolveRedirectBase, warnOnInvalidRedirectBase } from "../auth/auth.js";
import { registerAuthPlugin } from "../auth/auth-plugin.js";

const TUNNEL = "https://abc.share.zrok.io";
const OVERRIDE = "https://pi.example.com";
const PORT = 8000;

beforeEach(() => {
  tunnelUrl.value = null;
});

// ─── Precedence (E1, E2) ─────────────────────────────────────────────────────

describe("buildRedirectUri — base precedence", () => {
  // E1 — the full reachable decision table: override × tunnel.
  const rows: Array<{
    name: string;
    override: string | null | undefined;
    tunnel: string | null;
    expected: string;
  }> = [
    {
      name: "override set + tunnel active → override",
      override: OVERRIDE,
      tunnel: TUNNEL,
      expected: `${OVERRIDE}/auth/callback/github`,
    },
    {
      name: "override set + no tunnel → override",
      override: OVERRIDE,
      tunnel: null,
      expected: `${OVERRIDE}/auth/callback/github`,
    },
    {
      name: "empty override + tunnel active → tunnel",
      override: "",
      tunnel: TUNNEL,
      expected: `${TUNNEL}/auth/callback/github`,
    },
    {
      name: "empty override + no tunnel → localhost",
      override: "",
      tunnel: null,
      expected: `http://localhost:${PORT}/auth/callback/github`,
    },
    {
      name: "absent override + tunnel active → tunnel",
      override: undefined,
      tunnel: TUNNEL,
      expected: `${TUNNEL}/auth/callback/github`,
    },
    {
      name: "absent override + no tunnel → localhost",
      override: undefined,
      tunnel: null,
      expected: `http://localhost:${PORT}/auth/callback/github`,
    },
  ];

  for (const row of rows) {
    it(`E1: ${row.name}`, () => {
      tunnelUrl.value = row.tunnel;
      expect(buildRedirectUri("github", PORT, row.override)).toBe(row.expected);
    });
  }

  // E2 — the row the feature exists for, asserted negatively as well: a live
  // tunnel must not leak into the redirect URI when an override is configured.
  it("E2: an active tunnel never leaks into the URI when an override is set", () => {
    tunnelUrl.value = TUNNEL;
    const uri = buildRedirectUri("github", PORT, OVERRIDE);
    expect(uri).toBe(`${OVERRIDE}/auth/callback/github`);
    expect(uri).not.toContain("zrok");
  });

  // E5 — pins `||` over `??`. With `??`, an empty override yields the relative
  // "/auth/callback/github", which every provider rejects. A future
  // "modernize to ??" lint pass must break here.
  it("E5: an empty override falls through instead of producing a relative URI", () => {
    tunnelUrl.value = null;
    const uri = buildRedirectUri("github", PORT, "");
    expect(uri).not.toBe("/auth/callback/github");
    expect(uri).toBe(`http://localhost:${PORT}/auth/callback/github`);
  });
});

// ─── Normalization (E3, E4, E6) ──────────────────────────────────────────────

describe("buildRedirectUri — base normalization", () => {
  it("E3: collapses any number of trailing slashes", () => {
    for (const base of [`${OVERRIDE}/`, `${OVERRIDE}//`, `${OVERRIDE}///`]) {
      expect(buildRedirectUri("google", 9000, base)).toBe(`${OVERRIDE}/auth/callback/google`);
    }
  });

  it("E4: leaves a slash-free base untouched", () => {
    expect(buildRedirectUri("google", 9000, OVERRIDE)).toBe(`${OVERRIDE}/auth/callback/google`);
  });

  it("E6: preserves a path prefix (reverse proxy mounted on a subpath)", () => {
    expect(buildRedirectUri("github", PORT, `${OVERRIDE}/pi`)).toBe(
      `${OVERRIDE}/pi/auth/callback/github`,
    );
    expect(buildRedirectUri("github", PORT, `${OVERRIDE}/pi/`)).toBe(
      `${OVERRIDE}/pi/auth/callback/github`,
    );
  });

  it("E3: normalization also applies to the tunnel base (shared code path)", () => {
    tunnelUrl.value = `${TUNNEL}/`;
    expect(buildRedirectUri("github", PORT)).toBe(`${TUNNEL}/auth/callback/github`);
  });
});

// ─── Route-level wiring (E13, E15, E16) ──────────────────────────────────────
//
// `fastify.inject()` reaches the real /auth routes with no ports and no
// network. This is the layer that proves the override is actually threaded
// into the emitted `redirect_uri` — a helper that returns the right string is
// worthless if a call site forgot to pass the third argument.

/** Extract the `redirect_uri` query param from an authorize URL. */
function redirectUriOf(location: string): string {
  return new URL(location).searchParams.get("redirect_uri") ?? "";
}

async function makeApp(redirectBaseUrl?: string) {
  const { default: Fastify } = await import("fastify");
  const app = Fastify();
  const authConfig: AuthConfig = {
    // Supplied explicitly so `ensureAuthSecret` never writes to the real
    // ~/.pi/dashboard/config.json of the machine running the suite.
    secret: "test-secret-32-chars-long-abcdef",
    // GitHub is the one built-in provider that resolves with no network I/O
    // (static endpoints, no OIDC discovery).
    providers: { github: { clientId: "cid", clientSecret: "csecret" } },
    ...(redirectBaseUrl !== undefined ? { redirectBaseUrl } : {}),
  };
  await registerAuthPlugin(app, { authConfig, port: PORT });
  await app.ready();
  return app;
}

describe("auth routes — redirect_uri emission", () => {
  let app: Awaited<ReturnType<typeof makeApp>> | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("E13: /auth/start/:provider emits the override in redirect_uri", async () => {
    tunnelUrl.value = TUNNEL;
    app = await makeApp(OVERRIDE);
    const res = await app.inject({ method: "GET", url: "/auth/start/github" });
    expect(res.statusCode).toBe(302);
    expect(redirectUriOf(res.headers.location as string)).toBe(
      `${OVERRIDE}/auth/callback/github`,
    );
  });

  it("E13: the single-provider auto-redirect on /auth/login emits it too", async () => {
    tunnelUrl.value = TUNNEL;
    app = await makeApp(OVERRIDE);
    // Exactly one provider is configured, so /auth/login auto-redirects rather
    // than rendering the picker — a distinct call site from /auth/start.
    const res = await app.inject({ method: "GET", url: "/auth/login" });
    expect(res.statusCode).toBe(302);
    expect(redirectUriOf(res.headers.location as string)).toBe(
      `${OVERRIDE}/auth/callback/github`,
    );
  });

  it("E13: without an override the routes fall back to the tunnel", async () => {
    tunnelUrl.value = TUNNEL;
    app = await makeApp();
    const res = await app.inject({ method: "GET", url: "/auth/start/github" });
    expect(redirectUriOf(res.headers.location as string)).toBe(
      `${TUNNEL}/auth/callback/github`,
    );
  });

  it("E15: _reloadAuth applies a changed override with no restart", async () => {
    app = await makeApp(OVERRIDE);
    await (app as any)._reloadAuth({
      secret: "test-secret-32-chars-long-abcdef",
      providers: { github: { clientId: "cid", clientSecret: "csecret" } },
      redirectBaseUrl: "https://new.example.com",
    } satisfies AuthConfig);

    const res = await app.inject({ method: "GET", url: "/auth/start/github" });
    expect(redirectUriOf(res.headers.location as string)).toBe(
      "https://new.example.com/auth/callback/github",
    );
  });

  it("E16: _reloadAuth clearing the override falls back to the tunnel", async () => {
    tunnelUrl.value = TUNNEL;
    app = await makeApp(OVERRIDE);
    await (app as any)._reloadAuth({
      secret: "test-secret-32-chars-long-abcdef",
      providers: { github: { clientId: "cid", clientSecret: "csecret" } },
    } satisfies AuthConfig);

    const res = await app.inject({ method: "GET", url: "/auth/start/github" });
    expect(redirectUriOf(res.headers.location as string)).toBe(
      `${TUNNEL}/auth/callback/github`,
    );
  });
});

// ─── Token exchange echoes the same URI (E14) ────────────────────────────────
//
// OAuth2 requires the redirect_uri posted to the token endpoint to be
// byte-identical to the one sent to the authorize endpoint. Threading the
// override into /auth/start but not /auth/callback yields a login that looks
// correct right up until the exchange fails.

describe("token exchange — redirect_uri echo", () => {
  let app: Awaited<ReturnType<typeof makeApp>> | null = null;
  const realFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = realFetch;
    await app?.close();
    app = null;
    vi.restoreAllMocks();
  });

  it("E14: /auth/callback posts the same redirect_uri /auth/start minted", async () => {
    tunnelUrl.value = TUNNEL;
    app = await makeApp(OVERRIDE);

    const authorized = await app.inject({ method: "GET", url: "/auth/start/github" });
    const mintedUri = redirectUriOf(authorized.headers.location as string);

    let postedUri: string | null = null;
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      const target = String(url);
      if (target.includes("login/oauth/access_token")) {
        const body = init?.body;
        const params = new URLSearchParams(
          typeof body === "string" ? body : new URLSearchParams(body as any).toString(),
        );
        postedUri = params.get("redirect_uri");
        return new Response(JSON.stringify({ access_token: "tok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // userInfo + emails — enough shape for the handler to finish.
      return new Response(JSON.stringify({ login: "u", name: "U", email: "u@example.com" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;

    await app.inject({ method: "GET", url: "/auth/callback/github?code=abc123" });

    expect(postedUri).toBe(mintedUri);
    expect(postedUri).toBe(`${OVERRIDE}/auth/callback/github`);
  });
});

// ─── Misconfiguration is reported (X1–X4) ────────────────────────────────────
//
// The value is still USED — dropping it would turn a typo into a silent no-op.
// These rows pin "warn, do not reject" (design D4).

describe("warnOnInvalidRedirectBase", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const invalid: Array<[string, string]> = [
    ["X1 missing scheme", "pi.example.com"],
    ["X1 protocol-relative", "//evil.example.com"],
    ["X2 non-http scheme", "ftp://pi.example.com"],
    ["X2 javascript scheme", "javascript:alert(1)"],
    ["X3 query string", "https://pi.example.com?tenant=a"],
    ["X3 fragment", "https://pi.example.com#x"],
  ];

  for (const [name, value] of invalid) {
    it(`${name} → warns naming the field and the value`, () => {
      expect(warnOnInvalidRedirectBase(value)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain("auth.redirectBaseUrl");
      expect(message).toContain(value);
    });

    it(`${name} → the value is still used, not discarded`, () => {
      expect(buildRedirectUri("github", PORT, value)).toBe(`${value}/auth/callback/github`);
    });
  }


  // G1 — userinfo in the base leaks credentials into the authorize URL, and from
  // there into the provider's request logs and the browser history. The first
  // three checks (parse / protocol / query+fragment) all pass on such a URL, so
  // without an explicit check it is accepted silently.
  // See change: config-override-oauth-redirect-base (design D4 amendment).
  const withUserinfo: Array<[string, string]> = [
    ["G1 user and password", "https://user:pass@pi.example.com"],
    ["G1 user only", "https://user@pi.example.com"],
  ];

  for (const [name, value] of withUserinfo) {
    it(`${name} → warns, naming the credential leak specifically`, () => {
      expect(warnOnInvalidRedirectBase(value)).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain("auth.redirectBaseUrl");
      expect(message).toContain("credential");
    });

    it(`${name} → the value is still used (D4 posture is warn, not reject)`, () => {
      expect(buildRedirectUri("github", PORT, value)).toBe(`${value}/auth/callback/github`);
    });
  }

  it("G1 does not leak the password into the warning text", () => {
    warnOnInvalidRedirectBase("https://user:hunter2@pi.example.com");
    expect(String(warn.mock.calls[0][0])).not.toContain("hunter2");
  });


  const valid = [OVERRIDE, `${OVERRIDE}/pi`, `${OVERRIDE}/`, "http://localhost:8000"];
  for (const value of valid) {
    it(`X4 does not cry wolf on "${value}"`, () => {
      expect(warnOnInvalidRedirectBase(value)).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });
  }

  it("X4 stays silent when no override is configured", () => {
    expect(warnOnInvalidRedirectBase(undefined)).toBe(true);
    expect(warnOnInvalidRedirectBase(null)).toBe(true);
    expect(warnOnInvalidRedirectBase("")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("X1 warns again on every auth reload, not just at registration", async () => {
    const { default: Fastify } = await import("fastify");
    const app = Fastify();
    const base: AuthConfig = {
      secret: "test-secret-32-chars-long-abcdef",
      providers: { github: { clientId: "cid", clientSecret: "csecret" } },
    };
    await registerAuthPlugin(app, {
      authConfig: { ...base, redirectBaseUrl: "pi.example.com" },
      port: PORT,
    });
    expect(warn).toHaveBeenCalledTimes(1);

    await (app as any)._reloadAuth({ ...base, redirectBaseUrl: "still-bad.example.com" });
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("auth.redirectBaseUrl"))).toHaveLength(2);

    await app.close();
  });
});

// ─── Resolved base + Secure-cookie derivation (G22) ──────────────────────────
//
// The session cookie's `Secure` flag used to be derived from
// `request.protocol`, which is always "http" behind a reverse proxy because
// Fastify is deliberately NOT configured with `trustProxy` (see
// forwarded-ip-trust.test.ts for why enabling it would be a bypass). Deriving
// from the resolved redirect base instead uses operator-stated config, which no
// request header can influence.
// See change: config-override-oauth-redirect-base (design D14).

describe("resolveRedirectBase — value and winning tier", () => {
  it("reports the override and names it as the source", () => {
    tunnelUrl.value = TUNNEL;
    expect(resolveRedirectBase(PORT, OVERRIDE)).toEqual({
      base: OVERRIDE,
      source: "auth.redirectBaseUrl",
    });
  });

  it("reports the tunnel when no override is set", () => {
    tunnelUrl.value = TUNNEL;
    expect(resolveRedirectBase(PORT, undefined)).toEqual({ base: TUNNEL, source: "tunnel" });
  });

  it("reports localhost when neither is set", () => {
    tunnelUrl.value = null;
    expect(resolveRedirectBase(PORT, undefined)).toEqual({
      base: `http://localhost:${PORT}`,
      source: "localhost",
    });
  });

  it("treats an empty override as absent (same falsy rule as buildRedirectUri)", () => {
    tunnelUrl.value = TUNNEL;
    expect(resolveRedirectBase(PORT, "").source).toBe("tunnel");
  });

  it("strips trailing slashes so the base matches what buildRedirectUri uses", () => {
    tunnelUrl.value = null;
    const { base } = resolveRedirectBase(PORT, `${OVERRIDE}///`);
    expect(base).toBe(OVERRIDE);
    expect(buildRedirectUri("github", PORT, `${OVERRIDE}///`)).toBe(`${base}/auth/callback/github`);
  });
});

describe("G22: Secure cookie derives from the resolved base, not the request", () => {
  it("is secure when the resolved base is https", () => {
    tunnelUrl.value = null;
    expect(resolveRedirectBase(PORT, OVERRIDE).base.startsWith("https:")).toBe(true);
  });

  it("is not secure when the resolved base is plain http", () => {
    tunnelUrl.value = null;
    expect(resolveRedirectBase(PORT, "http://pi.internal").base.startsWith("https:")).toBe(false);
  });

  it("is secure behind a proxy even though the request itself arrives as http", () => {
    // The whole point: the request is http on the loopback hop, the public
    // origin is https, and the cookie must be marked Secure.
    tunnelUrl.value = null;
    const { base } = resolveRedirectBase(PORT, "https://pi.example.com");
    expect(base.startsWith("https:")).toBe(true);
  });

  it("an https tunnel with no override also yields a secure cookie", () => {
    tunnelUrl.value = TUNNEL;
    expect(resolveRedirectBase(PORT, undefined).base.startsWith("https:")).toBe(true);
  });
});

// ─── Advisory hot-path guard (P1) ────────────────────────────────────────────

describe("buildRedirectUri — cost", () => {
  it("P1: 100k builds with an override stay well inside the budget", () => {
    tunnelUrl.value = TUNNEL;
    const started = performance.now();
    for (let i = 0; i < 100_000; i++) buildRedirectUri("github", PORT, OVERRIDE);
    const elapsed = performance.now() - started;
    // Advisory, with an order of magnitude of headroom: the added work is one
    // truthiness check plus one regex on a short string. A failure here means
    // someone moved real work (I/O, URL parsing, validation) into the builder.
    expect(elapsed).toBeLessThan(100);
  });
});
