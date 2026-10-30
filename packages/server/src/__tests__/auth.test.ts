import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import jwt from "jsonwebtoken";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AuthUser,
  buildAuthorizeUrl,
  buildProviderRegistry,
  buildRedirectUri,
  classifyProviderConfig,
  COOKIE_NAME,
  ensureAuthSecret,
  isOpenEnrolment,
  isUserAllowed,
  openEnrolmentOf,
  PUBLIC_IDP_HOSTS,
  parseAuthCookie,
  type ResolvedProvider,
  signToken,
  verifyToken,
} from "../auth/auth.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

// ─── JWT Token Tests ────────────────────────────────────────────────────────

describe("signToken / verifyToken", () => {
  const secret = "test-secret-32-chars-long-abcdef";
  const user: AuthUser = { sub: "user@example.com", name: "Test User", username: "testuser", provider: "github" };

  it("should sign and verify a token", () => {
    const token = signToken(user, secret);
    const payload = verifyToken(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user@example.com");
    expect(payload!.name).toBe("Test User");
    expect(payload!.provider).toBe("github");
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("should return null for tampered token", () => {
    const token = signToken(user, secret);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(verifyToken(tampered, secret)).toBeNull();
  });

  it("should return null for wrong secret", () => {
    const token = signToken(user, secret);
    expect(verifyToken(token, "wrong-secret")).toBeNull();
  });

  it("should return null for garbage string", () => {
    expect(verifyToken("not.a.jwt", secret)).toBeNull();
  });
});

// ─── B17 JWT algorithm pin (harden-auth-credentials, AE1/AE4/AE5/AE6) ──────

describe("verifyToken — HS256 pin (harden-auth-credentials)", () => {
  const S = crypto.randomBytes(32).toString("hex");
  const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
  const nowS = () => Math.floor(Date.now() / 1000);
  const payload = () => ({ sub: "u@example.com", name: "U", username: "u", provider: "github", exp: nowS() + 3600 });
  /** Hand-built JWT so the header `alg` is exactly what the case needs. */
  const build = (header: unknown, sigAlg: "sha256" | "sha384" | "sha512" | null, secret = S) => {
    const signing = `${b64(header)}.${b64(payload())}`;
    const sig = sigAlg ? crypto.createHmac(sigAlg, secret).update(signing).digest("base64url") : "";
    return `${signing}.${sig}`;
  };

  it.each([
    ["HS256", "sha256", true],
    ["HS384", "sha384", false],
    ["HS512", "sha512", false],
    ["none", null, false],
  ] as const)("AE1 alg %s → %s accepted=%s", (alg, sigAlg, accepted) => {
    const token = build({ alg, typ: "JWT" }, sigAlg);
    let out: ReturnType<typeof verifyToken> | undefined;
    expect(() => {
      out = verifyToken(token, S);
    }).not.toThrow();
    if (accepted) expect(out?.sub).toBe("u@example.com");
    else expect(out).toBeNull();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AE4 default expiry is 7 days: valid at T+604799s, null at T+604801s", () => {
    const T = 1_700_000_000_000;
    vi.useFakeTimers({ now: T });
    const user: AuthUser = { sub: "u@example.com", name: "U", username: "u", provider: "github" };
    const token = signToken(user, S);
    vi.setSystemTime(T + 604_799_000);
    const ok = verifyToken(token, S);
    expect(ok).not.toBeNull();
    expect(ok!.exp).toBe(T / 1000 + 604_800);
    vi.setSystemTime(T + 604_801_000);
    expect(verifyToken(token, S)).toBeNull();
  });

  it("AE5 a token minted before the pin (jsonwebtoken default HS256) still verifies", () => {
    const legacy = jwt.sign({ sub: "u@example.com", name: "U", username: "u", provider: "github" }, S);
    const out = verifyToken(legacy, S);
    expect(out).toMatchObject({ sub: "u@example.com", name: "U", username: "u", provider: "github" });
  });

  it.each([
    ["alg absent", build({ typ: "JWT" }, "sha256")],
    ["alg lower-case hs256", build({ alg: "hs256", typ: "JWT" }, "sha256")],
    ["alg array", build({ alg: ["HS256"], typ: "JWT" }, "sha256")],
    ["header not base64 JSON", `${b64("not json")}.${b64(payload())}.sig`],
    ["empty string", ""],
    ["two segments", "a.b"],
  ])("AE6 malformed header (%s) → null, never throws", (_name, token) => {
    let out: ReturnType<typeof verifyToken> | undefined;
    expect(() => {
      out = verifyToken(token, S);
    }).not.toThrow();
    expect(out).toBeNull();
  });
});

// ─── Cookie Parsing Tests ───────────────────────────────────────────────────

describe("parseAuthCookie", () => {
  it("should parse cookie from header", () => {
    const header = `other=abc; ${COOKIE_NAME}=mytoken123; another=def`;
    expect(parseAuthCookie(header)).toBe("mytoken123");
  });

  it("should return null when cookie not present", () => {
    expect(parseAuthCookie("other=abc")).toBeNull();
  });

  it("should return null for undefined header", () => {
    expect(parseAuthCookie(undefined)).toBeNull();
  });

  it("should parse when cookie is first", () => {
    expect(parseAuthCookie(`${COOKIE_NAME}=token1; other=x`)).toBe("token1");
  });

  it("should parse when cookie is only value", () => {
    expect(parseAuthCookie(`${COOKIE_NAME}=singletoken`)).toBe("singletoken");
  });
});

// ─── Email Allowlist Tests ──────────────────────────────────────────────────

describe("isUserAllowed", () => {
  it("should allow any user when allowedUsers is undefined", () => {
    expect(isUserAllowed("anyone@example.com", "anyone")).toBe(true);
  });

  it("should allow any user when allowedUsers is empty", () => {
    expect(isUserAllowed("anyone@example.com", "anyone", [])).toBe(true);
  });

  it("should allow exact email match", () => {
    expect(isUserAllowed("user@example.com", "user", ["user@example.com"])).toBe(true);
  });

  it("should allow exact username match", () => {
    expect(isUserAllowed("other@example.com", "octocat", ["octocat"])).toBe(true);
  });

  it("should reject non-matching email and username", () => {
    expect(isUserAllowed("other@example.com", "other", ["user@example.com"])).toBe(false);
  });

  it("should support domain wildcard", () => {
    expect(isUserAllowed("anyone@company.com", "anyone", ["*@company.com"])).toBe(true);
    expect(isUserAllowed("anyone@other.com", "anyone", ["*@company.com"])).toBe(false);
  });

  it("should be case-insensitive for email", () => {
    expect(isUserAllowed("User@Example.COM", "user", ["user@example.com"])).toBe(true);
    expect(isUserAllowed("test@Company.Com", "test", ["*@company.com"])).toBe(true);
  });

  it("should be case-insensitive for username", () => {
    expect(isUserAllowed("x@y.com", "OctoCat", ["octocat"])).toBe(true);
  });
});

// ─── Auth Secret Management Tests ───────────────────────────────────────────

describe("ensureAuthSecret", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-auth-secret-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("should return existing secret when present", () => {
    const config: AuthConfig = {
      secret: "existing-secret",
      providers: { github: { clientId: "id", clientSecret: "sec" } },
    };
    expect(ensureAuthSecret(config)).toBe("existing-secret");
  });

  it("should generate secret when missing and update config object", () => {
    // Note: persistence to file depends on CONFIG_FILE which is resolved at module load.
    // We test the in-memory behavior here.
    const config: AuthConfig = {
      secret: "",
      providers: { github: { clientId: "id", clientSecret: "sec" } },
    };
    const secret = ensureAuthSecret(config);

    // AE7 (harden-auth-credentials): 32 random bytes = 64 hex chars (was 16 bytes / 32).
    expect(secret).toHaveLength(64);
    expect(config.secret).toBe(secret);
    // Secret should be hex
    expect(/^[0-9a-f]{64}$/.test(secret)).toBe(true);
  });

  it("should generate different secrets each time", () => {
    const config1: AuthConfig = { secret: "", providers: {} };
    const config2: AuthConfig = { secret: "", providers: {} };
    const s1 = ensureAuthSecret(config1);
    const s2 = ensureAuthSecret(config2);
    expect(s1).not.toBe(s2);
  });
});

// ─── Provider Registry Tests ────────────────────────────────────────────────

describe("buildProviderRegistry", () => {
  // We test buildProviderRegistry indirectly through the resolved provider for GitHub
  // (since Google/Keycloak/OIDC require OIDC discovery which needs network)

  it("should resolve GitHub provider with hardcoded endpoints", async () => {
    const registry = await buildProviderRegistry({
      github: { clientId: "gh-id", clientSecret: "gh-secret" },
    });
    expect(registry.size).toBe(1);
    const gh = registry.get("github")!;
    expect(gh.name).toBe("GitHub");
    expect(gh.authorizeUrl).toBe("https://github.com/login/oauth/authorize");
    expect(gh.tokenUrl).toBe("https://github.com/login/oauth/access_token");
    expect(gh.userInfoUrl).toBe("https://api.github.com/user");
    expect(gh.scopes).toBe("user:email");
    expect(gh.clientId).toBe("gh-id");
  });

  it("should return empty registry for empty providers", async () => {
    const registry = await buildProviderRegistry({});
    expect(registry.size).toBe(0);
  });

  it("should skip providers that fail to resolve (e.g. OIDC without issuerUrl)", async () => {
    const registry = await buildProviderRegistry({
      keycloak: { clientId: "kc", clientSecret: "ks" }, // missing issuerUrl
      github: { clientId: "gh", clientSecret: "gs" },
    });
    // keycloak should be skipped (no issuerUrl), github should resolve
    expect(registry.size).toBe(1);
    expect(registry.has("github")).toBe(true);
  });
});

// ─── Redirect URI Builder Tests ─────────────────────────────────────────────

describe("buildRedirectUri", () => {
  // No tunnel runtime exists in tests, so getTunnelUrl() returns null and the
  // localhost fallback is exercised.

  it("falls back to localhost when no tunnel and no override", () => {
    expect(buildRedirectUri("github", 8000)).toBe(
      "http://localhost:8000/auth/callback/github",
    );
  });

  it("uses the config-file override when provided (highest precedence)", () => {
    expect(buildRedirectUri("github", 8000, "https://pi.example.com")).toBe(
      "https://pi.example.com/auth/callback/github",
    );
  });

  it("normalizes a trailing slash on the override base", () => {
    expect(buildRedirectUri("google", 9000, "https://pi.example.com/")).toBe(
      "https://pi.example.com/auth/callback/google",
    );
    expect(buildRedirectUri("google", 9000, "https://pi.example.com///")).toBe(
      "https://pi.example.com/auth/callback/google",
    );
  });

  it("treats an empty override like an absent one (falls back to localhost)", () => {
    expect(buildRedirectUri("github", 8000, "")).toBe(
      "http://localhost:8000/auth/callback/github",
    );
  });
});

// ─── Authorize URL Builder Tests ────────────────────────────────────────────

describe("buildAuthorizeUrl", () => {
  it("should build correct authorize URL", () => {
    const provider: ResolvedProvider = {
      key: "github",
      name: "GitHub",
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      userInfoUrl: "https://api.github.com/user",
      scopes: "user:email",
      clientId: "my-client-id",
      clientSecret: "secret",
    };
    const url = buildAuthorizeUrl(provider, "http://localhost:8000/auth/callback/github", "state123");
    expect(url).toContain("https://github.com/login/oauth/authorize?");
    expect(url).toContain("client_id=my-client-id");
    expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fauth%2Fcallback%2Fgithub");
    expect(url).toContain("scope=user%3Aemail");
    expect(url).toContain("state=state123");
    expect(url).toContain("response_type=code");
  });
});

// ── The login/SPA surface stays reachable with auth OFF (S9, S10, S11) ───────
// The universal guard's jurisdiction is namespace-scoped precisely so the
// "auth off, over a tunnel" deployment — the one this change exists to fix —
// does not lock itself out of its own app shell. These are the lock-out
// regression tests for that deployment.
//
// See change: add-universal-network-guard.
describe("auth-off tunnel surface stays reachable (S9, S10, S11)", () => {
  let handle: TestServerHandle;
  const TUNNELED = { "x-forwarded-for": "203.0.113.5" };

  beforeAll(async () => {
    handle = await createTestServer();
  }, 60_000);

  afterAll(async () => {
    await handle?.stop();
  });

  const url = (p: string) => `http://127.0.0.1:${handle.httpPort}${p}`;

  // test-plan #S9 — the SPA index is outside jurisdiction.
  it("serves GET / to an unauthenticated tunneled request", async () => {
    const res = await fetch(url("/"), { headers: TUNNELED });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root"');
  });

  // test-plan #S10 — the deep-link refresh path goes through setNotFoundHandler.
  it("serves GET /settings via the SPA fallback", async () => {
    const res = await fetch(url("/settings"), { headers: TUNNELED });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root"');
  });

  // test-plan #S11 — the client must be able to detect that auth is off.
  it("serves GET /auth/status unauthenticated", async () => {
    const res = await fetch(url("/auth/status"), { headers: TUNNELED });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("authEnabled");
  });
});

// ─── Public-IdP classification (close-security-map-high-findings D3) ─────────

describe("classifyProviderConfig — config-only decision table (#E59–#E72)", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const oidc = (issuerUrl: string) => classifyProviderConfig("oidc", { issuerUrl });

  it("#E59 key github with no issuerUrl is public", () => {
    expect(classifyProviderConfig("github", {})).toBe("public");
    expect(classifyProviderConfig("github")).toBe("public");
  });
  it("#E60 key google with no issuerUrl is public", () => {
    expect(classifyProviderConfig("google", {})).toBe("public");
  });
  it("#E61 the key is irrelevant: keycloak + accounts.google.com issuer is public", () => {
    expect(classifyProviderConfig("keycloak", { issuerUrl: "https://accounts.google.com" })).toBe("public");
    expect(oidc("https://accounts.google.com")).toBe("public");
  });
  it.each(["https://github.com", "https://gitlab.com", "https://appleid.apple.com"])("#E63-#E65 oidc issuer %s is public", (issuer) => {
    expect(oidc(issuer)).toBe("public");
  });
  it.each([
    "https://login.microsoftonline.com/common/v2.0",
    "https://login.microsoftonline.com/consumers/v2.0",
    "https://login.microsoftonline.com/organizations/v2.0",
    "https://login.microsoftonline.com/common",
    "https://login.microsoftonline.com/COMMON/v2.0",
  ])("#E66 multi-tenant Microsoft issuer %s is public", (issuer) => {
    expect(oidc(issuer)).toBe("public");
  });
  it.each([
    "https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/v2.0",
    "https://login.microsoftonline.com",
    "https://login.microsoftonline.com/common-x/v2.0",
  ])("#E67 single-tenant / bare Microsoft issuer %s is non-public", (issuer) => {
    expect(oidc(issuer)).toBe("non-public");
  });
  it.each([
    "https://accounts.google.com.evil.example",
    "https://sso.github.com",
    "https://evilgithub.com",
    "https://xaccounts.google.com",
    "https://github.com..",
    "https://gitlab.com.evil",
  ])("#E68 lookalike host %s is non-public (exact match, no wildcards)", (issuer) => {
    expect(oidc(issuer)).toBe("non-public");
  });
  it.each(["https://GITHUB.COM", "https://github.com.", "https://github.com:443", "http://accounts.google.com"])(
    "#E69 host normalisation: %s is public",
    (issuer) => {
      expect(oidc(issuer)).toBe("public");
    },
  );
  it("#E70 userinfo tricks: the host is the part after the @", () => {
    expect(oidc("https://accounts.google.com@evil.example")).toBe("non-public");
    expect(oidc("https://evil.example@accounts.google.com")).toBe("public");
  });
  it("#E71 self-hosted keycloak and a non-built-in key without issuerUrl are non-public", () => {
    expect(classifyProviderConfig("keycloak", { issuerUrl: "https://sso.example.com/realms/acme" })).toBe("non-public");
    expect(classifyProviderConfig("okta", {})).toBe("non-public");
    expect(classifyProviderConfig("okta", undefined)).toBe("non-public");
  });
  it.each(["not a url", "//", "", undefined, 42])("#E72 unparseable issuerUrl %j is non-public (G13), no throw", (issuer) => {
    expect(() => oidc(issuer as string)).not.toThrow();
    expect(oidc(issuer as string)).toBe("non-public");
  });

  it("never touches the network", () => {
    for (const k of ["github", "google", "oidc", "keycloak"]) classifyProviderConfig(k, { issuerUrl: "https://accounts.google.com" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the fixed set is exactly the five documented hosts", () => {
    expect([...PUBLIC_IDP_HOSTS].sort()).toEqual(
      ["accounts.google.com", "appleid.apple.com", "github.com", "gitlab.com", "login.microsoftonline.com"].sort(),
    );
  });
});

describe("isOpenEnrolment / openEnrolmentOf (same emptiness as isUserAllowed + resolveGroupTier)", () => {
  const providers = {
    github: { clientId: "a", clientSecret: "b" },
    keycloak: { clientId: "a", clientSecret: "b", issuerUrl: "https://sso.example.com/realms/acme" },
  };
  it("empty/unset allowedUsers and groupTiers is open; either set lifts it", () => {
    expect(isOpenEnrolment(undefined, undefined)).toBe(true);
    expect(isOpenEnrolment([], {})).toBe(true);
    expect(isOpenEnrolment([""], undefined)).toBe(false); // blank entry is a non-empty list
    expect(isOpenEnrolment([], { ops: "operate" })).toBe(false);
  });
  it("lists each configured provider with mode refused (public) / open (non-public); none when bounded", () => {
    expect(openEnrolmentOf(providers, [], undefined)).toEqual([
      { provider: "github", mode: "refused" },
      { provider: "keycloak", mode: "open" },
    ]);
    expect(openEnrolmentOf(providers, ["a@b.c"], undefined)).toEqual([]);
    expect(openEnrolmentOf(providers, undefined, { ops: "operate" })).toEqual([]);
    expect(openEnrolmentOf(undefined, [], undefined)).toEqual([]);
  });
});
