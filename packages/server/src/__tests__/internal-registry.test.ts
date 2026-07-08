/**
 * Tests for InternalRegistry custom-provider discovery (Approach C).
 *
 * The server process (not a pi session) must discover + register custom
 * providers from providers.json into its own registry, so GET /api/models
 * matches every pi session. Previously the custom-provider loop was a no-op.
 *
 * See change: add-agent-role-model-tools.
 */
import { describe, expect, it } from "vitest";
import { type CustomModelEntry, type CustomProviderEntry, InternalRegistry } from "../model-proxy/internal-registry.js";

// Minimal pi-ai stub: no built-in models.
const fakePiAi: any = {
  registerBuiltInApiProviders: () => {},
  getProviders: () => [],
  getModels: () => [],
  getModel: () => undefined,
  registerApiProvider: () => {},
  unregisterApiProviders: () => {},
  streamSimple: async function* () {},
};

const fakeAuthStorage: any = {
  getApiKeyAndHeaders: async () => ({ apiKey: "x", headers: {} }),
  reload: async () => {},
};

function makeRegistry(opts: {
  providers: Record<string, CustomProviderEntry>;
  discovered: CustomModelEntry[];
  auth: Record<string, any>;
}) {
  return new InternalRegistry(fakePiAi, fakeAuthStorage, {
    readProviders: () => opts.providers,
    readModels: () => [],
    readAuth: () => opts.auth,
    discoverCustomProviders: async () => opts.discovered,
  });
}

describe("InternalRegistry custom-provider discovery", () => {
  it("registers discovered custom-provider models with a non-empty baseUrl", async () => {
    const reg = makeRegistry({
      providers: { "bence-proxy": { baseUrl: "https://proxy.example/v1", apiKey: "k" } },
      discovered: [
        { id: "foo-v2", provider: "bence-proxy", api: "openai-completions", baseUrl: "https://proxy.example/v1" },
      ],
      auth: { "bence-proxy": { type: "api_key", key: "k" } },
    });

    // Before discovery the no-op path yields zero custom models.
    expect(reg.getAll().some((m) => m.provider === "bence-proxy")).toBe(false);

    await reg.discover();

    const all = reg.getAll();
    const model = all.find((m) => m.provider === "bence-proxy" && m.id === "foo-v2");
    expect(model).toBeDefined();
    expect(model.baseUrl).toBe("https://proxy.example/v1");
    expect(model.baseUrl).not.toBe("");
  });

  it("surfaces discovered custom models in getAvailable when the provider is authed", async () => {
    const reg = makeRegistry({
      providers: { "bence-proxy": { baseUrl: "https://proxy.example/v1", apiKey: "k" } },
      discovered: [
        { id: "foo-v2", provider: "bence-proxy", api: "openai-completions", baseUrl: "https://proxy.example/v1" },
      ],
      auth: { "bence-proxy": { type: "api_key", key: "k" } },
    });
    await reg.discover();
    const available = await reg.getAvailable();
    expect(available.some((m) => m.provider === "bence-proxy" && m.id === "foo-v2")).toBe(true);
  });
});
