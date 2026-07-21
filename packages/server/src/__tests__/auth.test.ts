import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  signToken,
  verifyToken,
  parseAuthCookie,
  isUserAllowed,
  ensureAuthSecret,
  buildAuthorizeUrl,
  buildProviderRegistry,
  COOKIE_NAME,
  type AuthUser,
  type ResolvedProvider,
} from "../auth/auth.js";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

    expect(secret).toHaveLength(32);
    expect(config.secret).toBe(secret);
    // Secret should be hex
    expect(/^[0-9a-f]{32}$/.test(secret)).toBe(true);
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
