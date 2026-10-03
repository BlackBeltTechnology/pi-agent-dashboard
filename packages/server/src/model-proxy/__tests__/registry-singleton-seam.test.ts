/**
 * Custom-provider projection onto the single model runtime (test-plan #E7, #E8)
 * and the `registry-singleton` ↔ runtime wiring.
 *
 * The merged non-built-in providers are registered on the runtime so its
 * `streamSimple` can route them. A changed provider is UNREGISTERED before it
 * is re-registered (`registerProvider` merges, so a plain re-register keeps a
 * removed `apiKey`); a removed provider is unregistered; a provider whose key
 * does not resolve is never registered and its key never logged.
 *
 * Supersedes the former pi-ai compatibility seam-wiring suite (the seam is gone).
 *
 * See change: collapse-model-proxy-onto-modelruntime (D3, D6).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CustomModelEntry,
  type CustomProviderEntry,
  InternalRegistry,
  literalConfigValue,
} from "../internal-registry.js";
import type { RuntimeProviderConfig } from "../server-model-runtime.js";

interface Call {
  op: "register" | "unregister";
  id: string;
  config?: RuntimeProviderConfig;
}

/** A catalogue-only runtime fake that records projection calls. */
function fakeRuntime(builtins: Record<string, any[]> = { anthropic: [] }) {
  const calls: Call[] = [];
  const registered = new Map<string, RuntimeProviderConfig>();
  const runtime = {
    getProviders: () => Object.keys(builtins).map((id) => ({ id })),
    getModels: (provider?: string) => (provider ? (builtins[provider] ?? []) : Object.values(builtins).flat()),
    registerProvider: (id: string, config: RuntimeProviderConfig) => {
      calls.push({ op: "register", id, config });
      registered.set(id, { ...(registered.get(id) ?? {}), ...config });
    },
    unregisterProvider: (id: string) => {
      calls.push({ op: "unregister", id });
      registered.delete(id);
    },
  };
  return { runtime, calls, registered };
}

function makeRegistry(state: {
  providers: Record<string, CustomProviderEntry>;
  auth: Record<string, any>;
  discovered: CustomModelEntry[];
}) {
  const fx = fakeRuntime();
  const registry = new InternalRegistry(fx.runtime, {} as never, {
    readProviders: () => state.providers,
    readModels: () => [],
    readAuth: () => state.auth,
    discoverCustomProviders: async () => state.discovered,
  });
  return { ...fx, registry };
}

const acmeModels = (): CustomModelEntry[] => [
  { id: "a1", provider: "acme", api: "openai-completions", baseUrl: "https://acme.example/v1" },
  { id: "a2", provider: "acme", api: "openai-completions", baseUrl: "https://acme.example/v1" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("custom providers are projected onto the runtime", () => {
  it("registers a custom provider with its resolved key and both models", async () => {
    const { registry, registered } = makeRegistry({
      providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-acme" } },
      auth: { acme: { type: "api_key", key: "sk-acme" } },
      discovered: acmeModels(),
    });
    await registry.refresh();

    const config = registered.get("acme");
    expect(config).toMatchObject({ baseUrl: "https://acme.example/v1", api: "openai-completions", apiKey: "sk-acme" });
    expect(((config?.models ?? []) as Array<{ id: string }>).map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("never projects a built-in provider", async () => {
    const { registry, calls } = makeRegistry({
      providers: {},
      auth: { anthropic: { type: "api_key", key: "sk" } },
      discovered: [{ id: "x", provider: "anthropic", api: "anthropic-messages" }],
    });
    await registry.refresh();
    expect(calls.filter((c) => c.id === "anthropic")).toEqual([]);
  });

  it("E7a: a removed provider is unregistered and leaves the catalogue", async () => {
    const state = {
      providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-acme" } } as Record<string, CustomProviderEntry>,
      auth: { acme: { type: "api_key", key: "sk-acme" } } as Record<string, any>,
      discovered: acmeModels(),
    };
    const { registry, registered, calls } = makeRegistry(state);
    await registry.refresh();
    expect(registered.has("acme")).toBe(true);

    state.providers = {};
    state.auth = {};
    state.discovered = [];
    await registry.refresh();

    expect(calls.at(-1)).toEqual({ op: "unregister", id: "acme" });
    expect(registered.has("acme")).toBe(false);
    expect(registry.getAll().some((m: any) => m.provider === "acme")).toBe(false);
    expect((await registry.getAvailable()).some((m: any) => m.provider === "acme")).toBe(false);
  });

  it("E7b: a changed provider is unregistered BEFORE it is re-registered, so a removed field is not kept", async () => {
    const state = {
      providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-old" } } as Record<string, CustomProviderEntry>,
      auth: { acme: { type: "api_key", key: "sk-old" } } as Record<string, any>,
      discovered: acmeModels(),
    };
    const { registry, calls, registered } = makeRegistry(state);
    await registry.refresh();

    // The key changes (the old one is removed from providers.json).
    state.providers = { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-new" } };
    state.auth = { acme: { type: "api_key", key: "sk-new" } };
    calls.length = 0;
    await registry.refresh();

    expect(calls.map((c) => c.op)).toEqual(["unregister", "register"]);
    expect(registered.get("acme")?.apiKey).toBe("sk-new");
    expect(JSON.stringify(registered.get("acme"))).not.toContain("sk-old");
  });

  it("E7b: an `apiKey` removed from providers.json is no longer used — the provider is unregistered", async () => {
    const state = {
      providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-old" } } as Record<string, CustomProviderEntry>,
      auth: { acme: { type: "api_key", key: "sk-old" } } as Record<string, any>,
      discovered: acmeModels(),
    };
    const { registry, registered } = makeRegistry(state);
    await registry.refresh();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    state.providers = { acme: { baseUrl: "https://acme.example/v1", apiKey: "" } };
    state.auth = {};
    await registry.refresh();

    expect(registered.has("acme")).toBe(false);
  });

  it("an unchanged provider is not re-registered on refresh", async () => {
    const { registry, calls } = makeRegistry({
      providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-acme" } },
      auth: { acme: { type: "api_key", key: "sk-acme" } },
      discovered: acmeModels(),
    });
    await registry.refresh();
    calls.length = 0;
    await registry.refresh();
    expect(calls).toEqual([]);
  });
});

describe("E8: an unresolved $ENV custom key", () => {
  it("does not throw, is not registered, other providers are, and no secret is logged", async () => {
    const lines: string[] = [];
    for (const m of ["warn", "error", "log", "info"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        lines.push(a.map(String).join(" "));
      });
    }
    // `$UNSET_VAR` does not resolve → registry-singleton's custom-cred reader
    // yields no key for `ghost`; `acme` resolved.
    const { registry, registered } = makeRegistry({
      providers: {
        ghost: { baseUrl: "https://ghost.example/v1", apiKey: "$UNSET_VAR" },
        acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-SENTINEL-acme" },
      },
      auth: { acme: { type: "api_key", key: "sk-SENTINEL-acme" } },
      discovered: [
        ...acmeModels(),
        { id: "g1", provider: "ghost", api: "openai-completions", baseUrl: "https://ghost.example/v1" },
      ],
    });

    await expect(registry.refresh()).resolves.toBeUndefined();
    expect(registered.has("ghost")).toBe(false);
    expect(registered.has("acme")).toBe(true);
    expect(lines.some((l) => l.includes('"ghost"'))).toBe(true);
    for (const l of lines) {
      expect(l).not.toContain("SENTINEL");
      expect(l).not.toContain("UNSET_VAR");
    }
  });

  it("a registration the runtime rejects is logged without the key and does not break the others", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    });
    const { registry, runtime, registered } = makeRegistry({
      providers: {},
      auth: { acme: { type: "api_key", key: "sk-SENTINEL" }, bad: { type: "api_key", key: "sk-SENTINEL-bad" } },
      discovered: [...acmeModels(), { id: "b1", provider: "bad", api: "openai-completions" }],
    });
    const original = runtime.registerProvider;
    runtime.registerProvider = (id: string, config: RuntimeProviderConfig) => {
      if (id === "bad") throw new Error('Provider bad: "api" is required');
      original(id, config);
    };

    await expect(registry.refresh()).resolves.toBeUndefined();
    expect(registered.has("acme")).toBe(true);
    expect(registered.has("bad")).toBe(false);
    expect(lines.some((l) => l.includes('"bad"'))).toBe(true);
    for (const l of lines) expect(l).not.toContain("SENTINEL");
  });
});

describe("a projected key is a literal, never a pi config template (audit)", () => {
  it("escapes `$` and a leading `!` with pi's `$$` / `$!` escapes", () => {
    expect(literalConfigValue("plain-key")).toBe("plain-key");
    expect(literalConfigValue("a$b")).toBe("a$$b");
    expect(literalConfigValue("$HOME")).toBe("$$HOME");
    expect(literalConfigValue("!echo pwned")).toBe("$!echo pwned");
  });

  it("the real runtime sends `!cmd` / `$VAR` keys verbatim and runs nothing", async () => {
    const { createRealRuntime, captureProviderStreams } = await import("../../__tests__/helpers/pi-models-fixture.js");
    const { InternalAuthStorage } = await import("../internal-auth-storage.js");
    const runtime = await createRealRuntime();
    const hostile = "!echo PWNED-$HOME";
    const auth = { evil: { type: "api_key" as const, key: hostile } };
    const reg = new InternalRegistry(runtime, new InternalAuthStorage(runtime, () => auth), {
      readProviders: () => ({ evil: { baseUrl: "https://evil.example/v1", apiKey: hostile } }),
      readModels: () => [],
      readAuth: () => auth,
      discoverCustomProviders: async () => [{ id: "e1", provider: "evil", api: "openai-completions", baseUrl: "https://evil.example/v1" }],
    });
    await reg.refresh();
    const model = await reg.find("evil", "e1");
    const captured = await captureProviderStreams(runtime, "evil");
    for await (const _e of runtime.streamSimple(model, { messages: [{ role: "user", content: "hi", timestamp: 0 }] })) {
      // drain
    }
    expect(captured).toHaveLength(1);
    expect(captured[0].options.apiKey).toBe(hostile);
  });
});

describe("projection changes reach the cached listing (CodeRabbit)", () => {
  it("a key removed between lookups drops the provider from the cached getAvailable()", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = {
      providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-acme" } } as Record<string, CustomProviderEntry>,
      auth: { acme: { type: "api_key", key: "sk-acme" } } as Record<string, any>,
      discovered: acmeModels(),
    };
    const { registry, registered } = makeRegistry(state);
    await registry.refresh();
    expect((await registry.getAvailable()).some((m: any) => m.provider === "acme")).toBe(true);

    state.auth = {}; // key removed externally, no refresh
    expect((await registry.getAvailable()).some((m: any) => m.provider === "acme")).toBe(false);
    expect(registered.has("acme")).toBe(false);
  });

  it("an unregisterProvider failure is logged, never breaks listing", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    });
    const state = {
      providers: { acme: { baseUrl: "https://acme.example/v1", apiKey: "sk-SENTINEL" } } as Record<string, CustomProviderEntry>,
      auth: { acme: { type: "api_key", key: "sk-SENTINEL" } } as Record<string, any>,
      discovered: acmeModels(),
    };
    const { registry, runtime } = makeRegistry(state);
    await registry.refresh();
    runtime.unregisterProvider = () => {
      throw new Error("unregister exploded");
    };
    state.providers = {};
    state.auth = {};
    state.discovered = [];

    await expect(registry.refresh()).resolves.toBeUndefined();
    await expect(registry.getAvailable()).resolves.toEqual([]);
    expect(lines.some((l) => l.includes('"acme"') && l.includes("unregister"))).toBe(true);
    for (const l of lines) expect(l).not.toContain("SENTINEL");
  });
});

describe("a rejected registration is not retried per lookup (CodeRabbit)", () => {
  it("logs once and does not re-register or defeat the listing cache until the config changes", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    });
    const state = {
      providers: {} as Record<string, CustomProviderEntry>,
      auth: { bad: { type: "api_key", key: "sk-bad" } } as Record<string, any>,
      discovered: [{ id: "b1", provider: "bad", api: "openai-completions" }] as CustomModelEntry[],
    };
    const { registry, runtime } = makeRegistry(state);
    const register = vi.fn((_id: string, _config: RuntimeProviderConfig) => {
      throw new Error("rejected by runtime");
    });
    runtime.registerProvider = register;

    await registry.refresh();
    await registry.getAvailable();
    await registry.getAvailable();
    await registry.find("bad", "b1");

    expect(register).toHaveBeenCalledTimes(1);
    expect(lines.filter((l) => l.includes('"bad"') && l.includes("registration failed"))).toHaveLength(1);

    // A changed config is retried.
    state.auth = { bad: { type: "api_key", key: "sk-bad-2" } };
    await registry.getAvailable();
    expect(register).toHaveBeenCalledTimes(2);
  });
});

describe("only runtime options reach streamSimple (CodeRabbit)", () => {
  it("drops apiKey and the transcript keys; forwards headers, maxTokens, temperature, signal", async () => {
    const singleton = await import("../registry-singleton.js");
    const { createRealRuntime, captureProviderStreams } = await import("../../__tests__/helpers/pi-models-fixture.js");
    const { _setRuntimeModuleLoaderForTests } = await import("../server-model-runtime.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
    fs.mkdirSync(path.dirname(authPath), { recursive: true });
    fs.writeFileSync(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant" } }), { mode: 0o600 });
    const real = await createRealRuntime();
    _setRuntimeModuleLoaderForTests(async () => ({ ModelRuntime: { create: async () => real } }));
    singleton.disposeModelRegistry();
    try {
      await singleton.getModelRegistry();
      const captured = await captureProviderStreams(real, "anthropic");
      const fn = singleton.getStreamSimpleFn();
      if (!fn) throw new Error("streamSimple not available");
      const signal = new AbortController().signal;
      const model = real.getModels("anthropic")[0];
      // The shape both /v1 wirings and the plugin seam hand over.
      for await (const _e of fn(model, { messages: [{ role: "user", content: "hi", timestamp: 0 }], systemPrompt: "SYS" }, {
        model,
        messages: [{ role: "user", content: "LEAK" }],
        system: "LEAK-SYSTEM",
        tools: [{ name: "LEAK-TOOL" }],
        apiKey: "sk-LEAK-OVERRIDE",
        headers: { "X-Org": "a" },
        maxTokens: 77,
        temperature: 0.3,
        signal,
      } as never)) {
        // drain
      }
      expect(captured).toHaveLength(1);
      const options = captured[0].options;
      expect(options.apiKey).toBe("sk-ant");
      expect(options.headers).toMatchObject({ "X-Org": "a" });
      expect(options.maxTokens).toBe(77);
      expect(options.temperature).toBe(0.3);
      expect(options.signal).toBeDefined();
      for (const key of ["system", "messages", "tools", "model"]) expect(options).not.toHaveProperty(key);
      expect(JSON.stringify(options)).not.toContain("LEAK");
      expect(JSON.stringify(captured[0].context)).toContain("SYS");
    } finally {
      _setRuntimeModuleLoaderForTests(null);
      singleton.disposeModelRegistry();
    }
  });
});
