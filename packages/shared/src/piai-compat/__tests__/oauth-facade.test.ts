/**
 * OAuth capability facade (design D7).
 *
 * Covers test-plan #X2 (the `export {}` type-only stub reports unavailable
 * instead of raising `TypeError`) and #X3 (the relocated async loaders work,
 * with the credential-shape translation in BOTH directions).
 *
 * The third case — the usable legacy `dist/oauth.js` — is what every ≤0.75.x
 * runtime ships, so all three resolution branches of D7 are pinned here.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { adaptPiAi } from "../index.js";
import { FIXTURE_PATH, makeFactoryFixture } from "../../test-support/piai-factory-fixture.js";
import { legacyFake } from "./fakes.js";

const signal = () => new AbortController().signal;
/** Only `dist/oauth.js` exists — NOT `dist/auth/oauth/load.js`. */
const onlyLegacyOAuthJs = (p: string) => p.endsWith(`dist${sep}oauth.js`);

describe("OAuth facade — legacy dist/oauth.js", () => {
  it("uses the legacy module when it exports the expected functions", async () => {
    const refreshToken = vi.fn(async () => ({ accessToken: "a2" }));
    const oauthModule = {
      getOAuthProvider: (id: string) => (id === "anthropic" ? { refreshToken } : undefined),
      refreshOAuthToken: vi.fn(async () => ({ accessToken: "generic" })),
    };
    const { oauth } = await adaptPiAi(legacyFake(), FIXTURE_PATH, {
      exists: onlyLegacyOAuthJs,
      importPath: async () => oauthModule,
    });

    expect(oauth.isAvailable("anthropic")).toBe(true);
    expect(oauth.getOAuthProvider("anthropic")).toBeTruthy();
    await oauth.getOAuthProvider("anthropic")!.refreshToken({ accessToken: "a1" }, signal());
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  // test-plan #X2 — the exact 0.86.1 shape. `{}` is TRUTHY, which is why the
  // pre-change `if (!this.oauthModule)` guard passed and then threw.
  it("reports unavailable for an `export {}` stub instead of throwing TypeError", async () => {
    const { oauth } = await adaptPiAi(legacyFake(), FIXTURE_PATH, {
      // Only dist/oauth.js exists, and it is the type-only stub.
      exists: onlyLegacyOAuthJs,
      importPath: async () => ({}),
    });

    expect(oauth.isAvailable("anthropic")).toBe(false);
    expect(oauth.unavailableReason?.("anthropic")).toBeTruthy();
    expect(oauth.getOAuthProvider("anthropic")).toBeUndefined();
    await expect(oauth.refreshOAuthToken("anthropic", {}, signal())).rejects.toThrow(/unavailable/);
  });

  it("rejects a legacy module missing one of the expected functions", async () => {
    const { oauth } = await adaptPiAi(legacyFake(), FIXTURE_PATH, {
      exists: onlyLegacyOAuthJs,
      importPath: async () => ({ getOAuthProvider: () => undefined }),
    });
    expect(oauth.isAvailable("anthropic")).toBe(false);
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
