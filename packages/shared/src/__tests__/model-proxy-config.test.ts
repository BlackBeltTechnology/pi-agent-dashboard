import { describe, it, expect } from "vitest";
import {
  parseModelProxyConfig,
  DEFAULT_MODEL_PROXY,
  type ModelProxyConfig,
} from "../config.js";

describe("parseModelProxyConfig", () => {
  it("returns defaults when input is missing", () => {
    expect(parseModelProxyConfig(undefined)).toEqual(DEFAULT_MODEL_PROXY);
    expect(parseModelProxyConfig(null)).toEqual(DEFAULT_MODEL_PROXY);
    expect(parseModelProxyConfig("string")).toEqual(DEFAULT_MODEL_PROXY);
  });

  it("returns defaults when input is empty object", () => {
    const result = parseModelProxyConfig({});
    expect(result.enabled).toBe(true);
    expect(result.maxConcurrentStreams).toBe(16);
    expect(result.perKeyConcurrentStreams).toBe(4);
    expect(result.logRequests).toBe(false);
    expect(result.apiKeys).toEqual([]);
  });

  it("preserves valid enabled flag", () => {
    expect(parseModelProxyConfig({ enabled: false }).enabled).toBe(false);
    expect(parseModelProxyConfig({ enabled: true }).enabled).toBe(true);
  });

  it("clamps maxConcurrentStreams to [1, 256]", () => {
    expect(parseModelProxyConfig({ maxConcurrentStreams: 0 }).maxConcurrentStreams).toBe(1);
    expect(parseModelProxyConfig({ maxConcurrentStreams: -5 }).maxConcurrentStreams).toBe(1);
    expect(parseModelProxyConfig({ maxConcurrentStreams: 500 }).maxConcurrentStreams).toBe(256);
    expect(parseModelProxyConfig({ maxConcurrentStreams: 32 }).maxConcurrentStreams).toBe(32);
    // Non-number falls back to default
    expect(parseModelProxyConfig({ maxConcurrentStreams: "ten" }).maxConcurrentStreams).toBe(16);
  });

  it("clamps perKeyConcurrentStreams to [1, 64]", () => {
    expect(parseModelProxyConfig({ perKeyConcurrentStreams: 0 }).perKeyConcurrentStreams).toBe(1);
    expect(parseModelProxyConfig({ perKeyConcurrentStreams: 100 }).perKeyConcurrentStreams).toBe(64);
    expect(parseModelProxyConfig({ perKeyConcurrentStreams: 8 }).perKeyConcurrentStreams).toBe(8);
  });

  it("accepts arbitrary string keys in perProviderCaps", () => {
    const result = parseModelProxyConfig({
      perProviderCaps: { anthropic: 5, google: 10, "custom-provider": 2 },
    });
    expect(result.perProviderCaps).toEqual({ anthropic: 5, google: 10, "custom-provider": 2 });
  });

  it("filters invalid perProviderCaps entries", () => {
    const result = parseModelProxyConfig({
      perProviderCaps: { valid: 5, bad: "nope", zero: 0, negative: -1 },
    });
    expect(result.perProviderCaps).toEqual({ valid: 5 });
  });

  it("clamps perProviderCaps values to max 256", () => {
    const result = parseModelProxyConfig({
      perProviderCaps: { huge: 999 },
    });
    expect(result.perProviderCaps).toEqual({ huge: 256 });
  });

  it("omits perProviderCaps when not an object", () => {
    expect(parseModelProxyConfig({ perProviderCaps: "bad" }).perProviderCaps).toBeUndefined();
    expect(parseModelProxyConfig({ perProviderCaps: [1] }).perProviderCaps).toBeUndefined();
  });

  it("validates apiKeys entries — rejects missing hash", () => {
    const result = parseModelProxyConfig({
      apiKeys: [
        { id: "a", label: "test", createdAt: 1000 }, // missing hash
        { id: "b", label: "ok", hash: "abc123", createdAt: 2000 },
      ],
    });
    expect(result.apiKeys).toHaveLength(1);
    expect(result.apiKeys[0].id).toBe("b");
  });

  it("validates apiKeys entries — rejects missing id/label/createdAt", () => {
    const result = parseModelProxyConfig({
      apiKeys: [
        { label: "no-id", hash: "h", createdAt: 1 },
        { id: "no-label", hash: "h", createdAt: 1 },
        { id: "no-time", label: "x", hash: "h" },
      ],
    });
    expect(result.apiKeys).toHaveLength(0);
  });

  it("preserves optional apiKey fields", () => {
    const result = parseModelProxyConfig({
      apiKeys: [
        {
          id: "k1",
          label: "full",
          hash: "sha",
          createdAt: 1000,
          createdBy: "alice@x",
          scopes: ["all"],
          lastUsedAt: 2000,
          expiresAt: 9999,
          revokedAt: 3000,
        },
      ],
    });
    expect(result.apiKeys[0]).toEqual({
      id: "k1",
      label: "full",
      hash: "sha",
      createdAt: 1000,
      createdBy: "alice@x",
      scopes: ["all"],
      lastUsedAt: 2000,
      expiresAt: 9999,
      revokedAt: 3000,
    });
  });

  it("filters non-string scopes in apiKeys", () => {
    const result = parseModelProxyConfig({
      apiKeys: [
        { id: "k1", label: "t", hash: "h", createdAt: 1, scopes: ["chat", 42, null, "messages"] },
      ],
    });
    expect(result.apiKeys[0].scopes).toEqual(["chat", "messages"]);
  });

  it("validates secondPort range [1024, 65535]", () => {
    expect(parseModelProxyConfig({ secondPort: 9876 }).secondPort).toBe(9876);
    expect(parseModelProxyConfig({ secondPort: 80 }).secondPort).toBeUndefined();
    expect(parseModelProxyConfig({ secondPort: 70000 }).secondPort).toBeUndefined();
    expect(parseModelProxyConfig({ secondPort: "bad" }).secondPort).toBeUndefined();
  });

  it("preserves defaultModel string", () => {
    expect(parseModelProxyConfig({ defaultModel: "gpt-4" }).defaultModel).toBe("gpt-4");
    expect(parseModelProxyConfig({ defaultModel: 42 }).defaultModel).toBeUndefined();
  });

  it("preserves preferredModels order, drops non-string/empty entries", () => {
    expect(
      parseModelProxyConfig({
        preferredModels: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
      }).preferredModels,
    ).toEqual(["anthropic/claude-3.5-sonnet", "openai/gpt-4o"]);
    // mixed garbage: keep only non-empty strings, preserve order
    expect(
      parseModelProxyConfig({
        preferredModels: ["a/b", 42, "", null, "c/d", { x: 1 }],
      }).preferredModels,
    ).toEqual(["a/b", "c/d"]);
    // absent / non-array / all-garbage → omit field
    expect(parseModelProxyConfig({}).preferredModels).toBeUndefined();
    expect(parseModelProxyConfig({ preferredModels: "bad" }).preferredModels).toBeUndefined();
    expect(parseModelProxyConfig({ preferredModels: [42, ""] }).preferredModels).toBeUndefined();
  });

  it("validates modelAliases as non-empty string→string map", () => {
    expect(
      parseModelProxyConfig({
        modelAliases: { claude: "anthropic/claude-3.5-sonnet", gpt: "openai/gpt-4o" },
      }).modelAliases,
    ).toEqual({ claude: "anthropic/claude-3.5-sonnet", gpt: "openai/gpt-4o" });
    // drop entries whose value is not a non-empty string
    expect(
      parseModelProxyConfig({
        modelAliases: { good: "p/m", bad: 42, empty: "", nul: null },
      }).modelAliases,
    ).toEqual({ good: "p/m" });
    // absent / non-object / all-garbage → omit field
    expect(parseModelProxyConfig({}).modelAliases).toBeUndefined();
    expect(parseModelProxyConfig({ modelAliases: "bad" }).modelAliases).toBeUndefined();
    expect(parseModelProxyConfig({ modelAliases: ["x"] }).modelAliases).toBeUndefined();
    expect(parseModelProxyConfig({ modelAliases: { bad: 42 } }).modelAliases).toBeUndefined();
  });

  it("preserves logRequests boolean", () => {
    expect(parseModelProxyConfig({ logRequests: true }).logRequests).toBe(true);
    expect(parseModelProxyConfig({ logRequests: "yes" }).logRequests).toBe(false); // falls back
  });
});
