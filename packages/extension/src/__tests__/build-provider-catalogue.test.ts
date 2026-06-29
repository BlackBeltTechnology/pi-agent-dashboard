/**
 * Tests for `_buildProviderCatalogue` — the bridge-side pure helper that
 * derives ProviderInfo[] from a captured ModelRegistry.
 * See change: replace-hardcoded-provider-lists.
 */
import { describe, it, expect } from "vitest";
import { _buildProviderCatalogue } from "../provider-register.js";

function makeRegistry(opts: {
  oauthIds?: string[];
  models?: Array<{ provider: string; id: string }>;
  authStatus?: Record<string, { configured: boolean; source?: string }>;
  registryAuthStatus?: Record<string, { configured: boolean; source?: string }>;
  credentials?: Record<string, { type: "oauth" | "api_key"; expires?: number; key?: string }>;
  displayNames?: Record<string, string>;
}): any {
  const reg: any = {
    authStorage: {
      getOAuthProviders: () => (opts.oauthIds ?? []).map((id) => ({ id, name: id })),
      getAuthStatus: (id: string) => opts.authStatus?.[id] ?? { configured: false },
      get: (id: string) => opts.credentials?.[id],
    },
    getAll: () => opts.models ?? [],
    getProviderDisplayName: (id: string) => opts.displayNames?.[id] ?? id,
  };
  // Only attach the registry-level status method when the test opts in, so the
  // existing scenarios exercise the authStorage fallback path (older pi).
  if (opts.registryAuthStatus) {
    reg.getProviderAuthStatus = (id: string) => opts.registryAuthStatus?.[id];
  }
  return reg;
}

describe("_buildProviderCatalogue", () => {
  it("returns [] when registry is null", () => {
    expect(_buildProviderCatalogue(null, {})).toEqual([]);
  });

  it("includes every OAuth id and every distinct model.provider, deduplicated", () => {
    const reg = makeRegistry({
      oauthIds: ["anthropic", "openai-codex"],
      models: [
        { provider: "anthropic", id: "claude-4" },
        { provider: "deepseek", id: "deepseek-chat" },
        { provider: "deepseek", id: "deepseek-coder" },
      ],
    });
    const cat = _buildProviderCatalogue(reg, {});
    const ids = cat.map((c) => c.id).sort();
    expect(ids).toEqual(["anthropic", "deepseek", "openai-codex"]);
  });

  it("sets hasOAuth true only for ids in the OAuth provider set", () => {
    const reg = makeRegistry({
      oauthIds: ["anthropic"],
      models: [{ provider: "anthropic", id: "x" }, { provider: "deepseek", id: "y" }],
    });
    const cat = _buildProviderCatalogue(reg, {});
    expect(cat.find((c) => c.id === "anthropic")?.hasOAuth).toBe(true);
    expect(cat.find((c) => c.id === "deepseek")?.hasOAuth).toBe(false);
  });

  it("populates displayName from getProviderDisplayName, falling back to id", () => {
    const reg = makeRegistry({
      models: [{ provider: "deepseek", id: "x" }, { provider: "custom-llm", id: "y" }],
      displayNames: { deepseek: "DeepSeek" },
    });
    const cat = _buildProviderCatalogue(reg, {});
    expect(cat.find((c) => c.id === "deepseek")?.displayName).toBe("DeepSeek");
    expect(cat.find((c) => c.id === "custom-llm")?.displayName).toBe("custom-llm");
  });

  it("populates configured + source from authStorage.getAuthStatus", () => {
    const reg = makeRegistry({
      models: [{ provider: "openai", id: "gpt-4" }],
      authStatus: { openai: { configured: false, source: "environment" } },
    });
    const cat = _buildProviderCatalogue(reg, {});
    const row = cat.find((c) => c.id === "openai")!;
    expect(row.configured).toBe(false);
    expect(row.source).toBe("environment");
  });

  it("populates expires for OAuth credentials in auth.json", () => {
    const reg = makeRegistry({
      oauthIds: ["anthropic"],
      models: [{ provider: "anthropic", id: "x" }],
      credentials: { anthropic: { type: "oauth", expires: 1234567890 } },
    });
    const cat = _buildProviderCatalogue(reg, {});
    expect(cat.find((c) => c.id === "anthropic")?.expires).toBe(1234567890);
  });

  it("api_key credentials do not surface expires", () => {
    const reg = makeRegistry({
      models: [{ provider: "openai", id: "x" }],
      credentials: { openai: { type: "api_key", key: "sk-..." } },
    });
    const cat = _buildProviderCatalogue(reg, {});
    expect(cat.find((c) => c.id === "openai")?.expires).toBeUndefined();
  });

  it("populates envVar from piAi.findEnvKeys (first entry)", () => {
    const reg = makeRegistry({ models: [{ provider: "openai", id: "x" }] });
    const cat = _buildProviderCatalogue(reg, {
      findEnvKeys: (id) => (id === "openai" ? ["OPENAI_API_KEY"] : undefined),
    });
    expect(cat.find((c) => c.id === "openai")?.envVar).toBe("OPENAI_API_KEY");
  });

  it("sets ambient when piAi.getEnvApiKey returns '<authenticated>'", () => {
    const reg = makeRegistry({ models: [{ provider: "google-vertex", id: "x" }] });
    const cat = _buildProviderCatalogue(reg, {
      getEnvApiKey: (id) => (id === "google-vertex" ? "<authenticated>" : undefined),
    });
    expect(cat.find((c) => c.id === "google-vertex")?.ambient).toBe(true);
  });

  it("ambient stays undefined for ordinary api keys", () => {
    const reg = makeRegistry({ models: [{ provider: "openai", id: "x" }] });
    const cat = _buildProviderCatalogue(reg, {
      getEnvApiKey: () => "sk-real-key",
    });
    expect(cat.find((c) => c.id === "openai")?.ambient).toBeUndefined();
  });

  it("does not throw when pi-ai helpers are missing", () => {
    const reg = makeRegistry({ models: [{ provider: "openai", id: "x" }] });
    expect(() => _buildProviderCatalogue(reg, {})).not.toThrow();
    const cat = _buildProviderCatalogue(reg, {});
    expect(cat[0].envVar).toBeUndefined();
    expect(cat[0].ambient).toBeUndefined();
  });

  it("marks ids in customIds set with custom:true; catalogue stays complete", () => {
    const reg = makeRegistry({
      models: [
        { provider: "deepseek", id: "deepseek-chat" },
        { provider: "proxy", id: "opus-4" },         // custom (registered via providers.json)
        { provider: "your-llmproxy", id: "foo" },    // custom
      ],
    });
    const customIds = new Set(["proxy", "your-llmproxy"]);
    const cat = _buildProviderCatalogue(reg, {}, customIds);
    // ALL providers present — the catalogue does not filter; consumers do.
    const ids = cat.map((c) => c.id).sort();
    expect(ids).toEqual(["deepseek", "proxy", "your-llmproxy"]);
    // Custom flag is set only for custom providers.
    expect(cat.find((c) => c.id === "deepseek")?.custom).toBeUndefined();
    expect(cat.find((c) => c.id === "proxy")?.custom).toBe(true);
    expect(cat.find((c) => c.id === "your-llmproxy")?.custom).toBe(true);
  });

  it("OAuth-handler ids carry custom:true when in customIds (custom OAuth provider)", () => {
    const reg = makeRegistry({
      oauthIds: ["corporate-sso"],
      models: [{ provider: "corporate-sso", id: "x" }, { provider: "deepseek", id: "y" }],
    });
    const cat = _buildProviderCatalogue(reg, {}, new Set(["corporate-sso"]));
    expect(cat.find((c) => c.id === "corporate-sso")?.hasOAuth).toBe(true);
    expect(cat.find((c) => c.id === "corporate-sso")?.custom).toBe(true);
  });

  it("empty customIds = no provider marked custom (default behaviour)", () => {
    const reg = makeRegistry({
      models: [{ provider: "deepseek", id: "x" }, { provider: "proxy", id: "y" }],
    });
    const cat = _buildProviderCatalogue(reg, {});
    const ids = cat.map((c) => c.id).sort();
    expect(ids).toEqual(["deepseek", "proxy"]);
    expect(cat.every((c) => !c.custom)).toBe(true);
  });

  it("derives configured/source from getProviderAuthStatus when present (custom provider)", () => {
    // The proxy key lives only in pi's providerRequestConfigs (registerProvider),
    // so authStorage is blind to it (configured:false) but the registry-level
    // getProviderAuthStatus reports it configured. The catalogue MUST follow the
    // registry-level status. See change: fix-custom-provider-save-and-auth.
    const reg = makeRegistry({
      models: [{ provider: "proxy", id: "opus-4" }],
      authStatus: { proxy: { configured: false } },
      registryAuthStatus: { proxy: { configured: true, source: "models_json_key" } },
    });
    const cat = _buildProviderCatalogue(reg, {}, new Set(["proxy"]));
    const row = cat.find((c) => c.id === "proxy")!;
    expect(row.configured).toBe(true);
    expect(row.source).toBe("models_json_key");
  });

  it("falls back to authStorage.getAuthStatus when getProviderAuthStatus is absent", () => {
    // No registryAuthStatus → method absent → fallback path (regression).
    const reg = makeRegistry({
      models: [{ provider: "openai", id: "gpt-4" }],
      authStatus: { openai: { configured: true, source: "environment" } },
    });
    const row = _buildProviderCatalogue(reg, {}).find((c) => c.id === "openai")!;
    expect(row.configured).toBe(true);
    expect(row.source).toBe("environment");
  });

  it("does not throw when getProviderDisplayName throws", () => {
    const reg = {
      authStorage: { getOAuthProviders: () => [], getAuthStatus: () => ({ configured: false }), get: () => undefined },
      getAll: () => [{ provider: "weird", id: "x" }],
      getProviderDisplayName: () => { throw new Error("boom"); },
    };
    const cat = _buildProviderCatalogue(reg, {});
    expect(cat[0].displayName).toBe("weird");
  });
});
