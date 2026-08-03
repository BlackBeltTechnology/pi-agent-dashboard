/**
 * getAllModels field-level outer join: discovery = routing authority, native
 * models.json = capabilities (win); native-only surfaces (outer join);
 * discovered-only keeps fallback floors; built-in wins over a custom entry
 * under a built-in name; oauthCompatible never taken from native.
 *
 * See change: honor-native-models-json-metadata (test-plan E4/E5/E6/E7/E8, §5).
 */
import { describe, expect, it } from "vitest";
import {
  type CustomModelEntry,
  type CustomProviderEntry,
  InternalRegistry,
  type InternalRegistryDeps,
  type PiAiModule,
} from "../internal-registry.js";

function makePiAi(builtins: Record<string, any[]>): PiAiModule {
  return {
    registerBuiltInApiProviders: () => {},
    getProviders: () => Object.keys(builtins),
    getModels: (provider: string) => builtins[provider] ?? [],
    getModel: () => null,
    registerApiProvider: () => {},
    unregisterApiProviders: () => {},
    streamSimple: async function* () {},
  } as unknown as PiAiModule;
}

async function buildRegistry(opts: {
  builtins?: Record<string, any[]>;
  providers?: Record<string, CustomProviderEntry>;
  discovered?: CustomModelEntry[];
  native?: CustomModelEntry[];
}): Promise<InternalRegistry> {
  const deps: InternalRegistryDeps = {
    readProviders: () => opts.providers ?? {},
    readModels: () => opts.native ?? [],
    readAuth: () => ({}),
    discoverCustomProviders: async () => opts.discovered ?? [],
  };
  const reg = new InternalRegistry(makePiAi(opts.builtins ?? {}), {} as any, deps);
  await reg.discover();
  return reg;
}

function pick(reg: InternalRegistry, provider: string, id: string): any {
  return reg.getAll().find((m) => m.provider === provider && m.id === id);
}

const NATIVE_MAP = { minimal: null, xhigh: "xhigh", max: "max" };

describe("getAllModels — native wins over discovery fallback (E4)", () => {
  it("merges: capabilities from native, routing from discovery", async () => {
    const reg = await buildRegistry({
      providers: { newapi: { baseUrl: "https://cfg.example/v1", apiKey: "k" } },
      discovered: [
        {
          provider: "newapi",
          id: "glm-5.2",
          baseUrl: "https://disc.example/v1",
          api: "openai-completions",
          contextWindow: 128000,
          maxTokens: 16384,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0 },
          oauthCompatible: true,
        },
      ],
      native: [
        {
          provider: "newapi",
          id: "glm-5.2",
          contextWindow: 200000,
          maxTokens: 65536,
          reasoning: true,
          thinkingLevelMap: NATIVE_MAP,
          compat: { thinkingFormat: "deepseek" },
          input: ["text", "image"],
          cost: { input: 3, output: 15 },
        },
      ],
    });
    const m = pick(reg, "newapi", "glm-5.2");
    // Capabilities from native
    expect(m.contextWindow).toBe(200000);
    expect(m.maxTokens).toBe(65536);
    expect(m.reasoning).toBe(true);
    expect(m.thinkingLevelMap).toEqual(NATIVE_MAP);
    expect(m.compat).toEqual({ thinkingFormat: "deepseek" });
    expect(m.input).toEqual(["text", "image"]);
    expect(m.cost).toEqual({ input: 3, output: 15 });
    // Routing from discovery
    expect(m.baseUrl).toBe("https://disc.example/v1");
    expect(m.api).toBe("openai-completions");
    expect(m.oauthCompatible).toBe(true);
    // exactly one entry
    expect(reg.getAll().filter((x) => x.provider === "newapi" && x.id === "glm-5.2")).toHaveLength(1);
  });
});

describe("getAllModels — native-only entry survives a discovery outage (E5)", () => {
  it("surfaces the native entry with routing from providers.json", async () => {
    const reg = await buildRegistry({
      providers: { newapi: { baseUrl: "https://cfg.example/v1", apiKey: "k", api: "openai-completions" } },
      discovered: [], // /v1/models unavailable
      native: [{ provider: "newapi", id: "glm-5.2", contextWindow: 200000, reasoning: true }],
    });
    const m = pick(reg, "newapi", "glm-5.2");
    expect(m).toBeDefined();
    expect(m.contextWindow).toBe(200000);
    expect(m.baseUrl).toBe("https://cfg.example/v1");
    expect(m.api).toBe("openai-completions");
  });
});

describe("getAllModels — discovered-only keeps fallback floors (E6)", () => {
  it("a discovered model with no native entry retains its floors", async () => {
    const reg = await buildRegistry({
      discovered: [{ provider: "newapi", id: "other-model", baseUrl: "https://disc.example/v1" }],
      native: [],
    });
    const m = pick(reg, "newapi", "other-model");
    expect(m.contextWindow).toBe(128000);
    expect(m.maxTokens).toBe(8192);
    expect(m.reasoning).toBe(false);
    expect(m.input).toEqual(["text"]);
  });
});

describe("getAllModels — built-in wins over a custom entry under a built-in name (E7)", () => {
  it("keeps the built-in model; the custom models.json entry does not override", async () => {
    const reg = await buildRegistry({
      builtins: { anthropic: [{ id: "claude-x", provider: "anthropic", __src: "builtin", contextWindow: 200000 }] },
      native: [{ provider: "anthropic", id: "claude-x", contextWindow: 999, __src: "custom" } as any],
    });
    const matches = reg.getAll().filter((m) => m.provider === "anthropic" && m.id === "claude-x");
    expect(matches).toHaveLength(1);
    expect(matches[0].__src).toBe("builtin");
    expect(matches[0].contextWindow).toBe(200000);
  });
});

describe("getAllModels — oauthCompatible never taken from native (E8)", () => {
  it("a native entry without oauthCompatible does not flip a discovered false to true", async () => {
    const reg = await buildRegistry({
      discovered: [{ provider: "newapi", id: "glm-5.2", baseUrl: "https://disc/v1", oauthCompatible: false }],
      native: [{ provider: "newapi", id: "glm-5.2", contextWindow: 200000 }],
    });
    const m = pick(reg, "newapi", "glm-5.2");
    expect(m.oauthCompatible).toBe(false);
    expect(m.contextWindow).toBe(200000); // native caps still merged
  });
});
