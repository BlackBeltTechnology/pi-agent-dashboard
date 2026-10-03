/**
 * OAuth capability facade (design D7).
 *
 * Covers test-plan #X2 (the `export {}` type-only stub reports unavailable
 * instead of raising `TypeError`) and #X3 (the relocated async loaders work,
 * with the credential-shape translation in BOTH directions).
 *
 * The legacy `dist/oauth.js` preference is retired (update-pi-core-1-0-adopt-apis):
 * a usable legacy `dist/oauth.js` is never consulted — only the relocated
 * loaders count.
 *
 * See change: adopt-piai-factory-api-registry, update-pi-core-1-0-adopt-apis.
 */
import { sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { adaptPiAi } from "../index.js";
import { FIXTURE_PATH, makeFactoryFixture } from "../../test-support/piai-factory-fixture.js";
import { factoryFake } from "./fakes.js";

const signal = () => new AbortController().signal;

describe("OAuth facade — dist/oauth.js is never consulted", () => {
  it("ignores a USABLE legacy dist/oauth.js when the relocated loaders are absent", async () => {
    const fx = makeFactoryFixture({
      oauthLoaders: null,
      oauthModule: { getOAuthProvider: () => ({ refreshToken: vi.fn() }), refreshOAuthToken: vi.fn() },
    });
    const imported: string[] = [];
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, {
      ...fx.deps,
      importPath: async (p: string) => {
        imported.push(p);
        return fx.deps.importPath(p);
      },
    });
    expect(imported.some((p) => p.endsWith(`dist${sep}oauth.js`))).toBe(false);
    expect(oauth.isAvailable("anthropic")).toBe(false);
  });

  it("prefers the relocated loaders even when a usable legacy dist/oauth.js exists", async () => {
    const fx = makeFactoryFixture({
      oauthModule: { getOAuthProvider: () => undefined, refreshOAuthToken: async () => ({}) },
    });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    expect(oauth.isAvailable("anthropic")).toBe(true);
  });

  // test-plan #X2 — the type-only `export {}` stub never surfaces as TypeError.
  it("reports unavailable (not TypeError) with only the `export {}` stub present", async () => {
    // Default fixture oauth.js IS the type-only stub; no relocated loaders.
    const fx = makeFactoryFixture({ oauthLoaders: null });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    expect(oauth.isAvailable("anthropic")).toBe(false);
    expect(oauth.unavailableReason?.("anthropic")).toBeTruthy();
    expect(oauth.getOAuthProvider("anthropic")).toBeUndefined();
    await expect(oauth.refreshOAuthToken("anthropic", {}, signal())).rejects.toThrow(/unavailable/);
  });
});

describe("OAuth facade — relocated async loaders", () => {
  // test-plan #X3
  it("refreshes through the relocated loaders, translating both credential shapes", async () => {
    const fx = makeFactoryFixture();
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    expect(oauth.isAvailable("anthropic")).toBe(true);
    const provider = oauth.getOAuthProvider("anthropic");
    expect(provider).toBeTruthy();

    // Storage speaks {accessToken, refreshToken, expiresAt}; the runtime
    // speaks {access, refresh, expires}. Both directions are translated.
    const out = await provider!.refreshToken(
      { accessToken: "A", refreshToken: "R", expiresAt: 1 },
      signal(),
    );
    expect(out).toEqual({ accessToken: "new-A", refreshToken: "new-R", expiresAt: 4_102_444_800_000 });
  });

  it("exposes the same translation through refreshOAuthToken", async () => {
    const fx = makeFactoryFixture();
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    const out = await oauth.refreshOAuthToken("openai-codex", { accessToken: "A", refreshToken: "R" }, signal());
    expect(out.accessToken).toBe("new-A");
  });

  // test-plan #X4 (the facade half) — degradation is PER-PROVIDER.
  it("degrades only the providers whose loader is missing or broken", async () => {
    const fx = makeFactoryFixture({
      oauthLoaders: {
        loadAnthropicOAuth: async () => ({ refresh: async () => ({ access: "ok" }) }),
        loadOpenAICodexOAuth: async () => {
          throw new Error("module moved");
        },
        loadGitHubCopilotOAuth: async () => ({}),
      },
    });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    expect(oauth.isAvailable("anthropic")).toBe(true);
    expect(oauth.isAvailable("openai-codex")).toBe(false);
    expect(oauth.unavailableReason?.("openai-codex")).toContain("module moved");
    // Loaded but shapeless — must NOT count as available.
    expect(oauth.isAvailable("github-copilot")).toBe(false);
    expect(oauth.unavailableReason?.("github-copilot")).toContain("refresh()");
    // Never mapped at all.
    expect(oauth.isAvailable("xai")).toBe(false);
  });

  it("reports every provider unavailable when the loader module itself is gone", async () => {
    const fx = makeFactoryFixture({ oauthLoaders: null });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    expect(oauth.isAvailable("anthropic")).toBe(false);
    expect(oauth.unavailableReason?.("anthropic")).toContain("load.js");
  });
});

// ── adopt-piai-factory-api-registry: review round 1 fixes ───────────────────

describe("OAuth facade — opaque credential fields survive the translation", () => {
  // Finding 3: pi's `OAuthCredentials` carries an index signature, and
  // `github-copilot` reads `credential.enterpriseUrl` back at refresh time
  // (`copilotEnterpriseDomain(credential)`). A three-field rebuild would send
  // an enterprise user's refresh to github.com and lose the metadata forever.
  it("forwards enterpriseUrl INTO the runtime refresh call", async () => {
    const seen: any[] = [];
    const fx = makeFactoryFixture({
      oauthLoaders: {
        loadGitHubCopilotOAuth: async () => ({
          refresh: async (credential: any) => {
            seen.push(credential);
            return { access: "a2", refresh: "r2", expires: 1 };
          },
        }),
      },
    });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    await oauth.getOAuthProvider("github-copilot")!.refreshToken(
      { accessToken: "a1", refreshToken: "r1", expiresAt: 1, enterpriseUrl: "ghe.corp.example" },
      signal(),
    );

    expect(seen[0].enterpriseUrl).toBe("ghe.corp.example");
    // Canonical names are translated, not duplicated.
    expect(seen[0].access).toBe("a1");
    expect(seen[0].refresh).toBe("r1");
    expect(seen[0].expires).toBe(1);
  });

  it("carries provider-returned opaque fields BACK out of the refresh", async () => {
    const fx = makeFactoryFixture({
      oauthLoaders: {
        loadGitHubCopilotOAuth: async () => ({
          refresh: async () => ({
            access: "a2",
            refresh: "r2",
            expires: 99,
            enterpriseUrl: "ghe.corp.example",
          }),
        }),
      },
    });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const out = await oauth.getOAuthProvider("github-copilot")!.refreshToken(
      { accessToken: "a1", refreshToken: "r1", expiresAt: 1 },
      signal(),
    );
    expect(out).toMatchObject({
      accessToken: "a2",
      refreshToken: "r2",
      expiresAt: 99,
      enterpriseUrl: "ghe.corp.example",
    });
  });
});

describe("OAuth facade — a malformed refresh is a failure, not a success", () => {
  // Finding 4: `{}` would flow into the storage's `?? cred.access` fallback,
  // which reuses the EXPIRED token while stamping a fresh expiry — persisting a
  // silently broken credential that will not be retried for an hour.
  it("rejects an empty refresh result", async () => {
    const fx = makeFactoryFixture({
      oauthLoaders: { loadAnthropicOAuth: async () => ({ refresh: async () => ({}) }) },
    });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    await expect(
      oauth.getOAuthProvider("anthropic")!.refreshToken({ accessToken: "a1", refreshToken: "r1" }, signal()),
    ).rejects.toThrow(/no access token/);
  });

  it("rejects a refresh result whose access token is missing or blank", async () => {
    for (const bad of [{ access: undefined }, { access: "" }, {}]) {
      const fx = makeFactoryFixture({
        oauthLoaders: { loadAnthropicOAuth: async () => ({ refresh: async () => bad }) },
      });
      const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
      await expect(
        oauth.getOAuthProvider("anthropic")!.refreshToken({ accessToken: "a1", refreshToken: "r1" }, signal()),
      ).rejects.toThrow(/no access token/);
    }
  });

  it("does not leak credential material in the malformed-refresh error", async () => {
    const fx = makeFactoryFixture({
      oauthLoaders: { loadAnthropicOAuth: async () => ({ refresh: async () => ({ access: "" }) }) },
    });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);

    const err = await oauth
      .getOAuthProvider("anthropic")!
      .refreshToken({ accessToken: "SECRET", refreshToken: "REFRESH_SECRET" }, signal())
      .catch((e: Error) => e);
    expect((err as Error).message).not.toContain("SECRET");
    expect((err as Error).message).not.toContain("REFRESH_SECRET");
  });
});

// ── spec: "Derived runtime subpaths SHALL be validated, never assumed" ──────
// Scenario: "Unexpected resolved layout is reported" — derivation SHALL fail
// with an error containing the resolved path, and the failure SHALL NOT be
// silently treated as a missing optional capability.

describe("OAuth facade — an unrecognized layout is REPORTED, not silently degraded", () => {
  it("propagates the derivation error on a factory-shaped module", async () => {
    const bad = "/opt/bundled/pi-ai/app.js";
    await expect(
      adaptPiAi(factoryFake(), bad, { importPath: async () => ({}), exists: () => false }),
    ).rejects.toThrowError(bad);
  });

  it("does not report the bad layout as 'no OAuth provider available'", async () => {
    const bad = "C:\\weird\\layout\\main.js";
    const err = await adaptPiAi(factoryFake(), bad, {
      importPath: async () => ({}),
      exists: () => false,
    }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    // The distinguishing assertion: NOT a capability report.
    expect((err as Error).message).toMatch(/expected the resolved module to end in/);
    expect((err as Error).message).not.toMatch(/no usable OAuth implementation/);
    // And it names the path that was actually resolved.
    expect((err as Error).message).toContain(bad);
  });

  it("still degrades to unavailable when the layout is fine but the loaders are absent", async () => {
    // The genuine optional-capability case must keep working.
    const fx = makeFactoryFixture({ oauthModule: null, oauthLoaders: null });
    const { oauth } = await adaptPiAi(fx.module, FIXTURE_PATH, fx.deps);
    expect(oauth.isAvailable("anthropic")).toBe(false);
    expect(oauth.unavailableReason?.("anthropic")).toMatch(/no usable OAuth implementation/);
  });
});
