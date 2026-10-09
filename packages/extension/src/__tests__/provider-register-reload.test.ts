/**
 * Tests for the provider-register hot-reload path.
 *
 * `reloadProviders(pi)` diffs the current providers.json against a
 * last-registered snapshot and calls pi.registerProvider / pi.unregisterProvider
 * as needed. Async model discovery is stubbed via a fetch mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandHandler } from "../command-handler.js";
import { refreshAfterCredentialsReload, refreshFullySucceeded, reportRefresh } from "../model-refresh.js";

// We re-import the module fresh in each test so module-level `lastRegistered`
// state starts empty.
async function importFresh() {
  vi.resetModules();
  return (await import("../provider-register.js")) as typeof import("../provider-register.js");
}

function makeMockPi() {
  const registerProvider = vi.fn();
  const unregisterProvider = vi.fn();
  const pi = {
    registerProvider,
    unregisterProvider,
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn(),
  } as any;
  return { pi, registerProvider, unregisterProvider };
}

function writeProvidersJson(home: string, providers: Record<string, any>) {
  const dir = join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "providers.json"),
    JSON.stringify({ providers }, null, 2),
    "utf-8",
  );
}

describe("reloadProviders", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "provider-reload-"));
    process.env.HOME = tmpHome;
    // Stub fetch to return 2 models so discovery succeeds cheaply
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 }),
    ) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("adds a new provider when providers.json gains an entry (snapshot was empty)", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      },
    });

    const diff = await mod.reloadProviders(pi);
    expect(diff.added).toEqual(["my-llm"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(registerProvider).toHaveBeenCalledTimes(1);
    expect(registerProvider).toHaveBeenCalledWith("my-llm", expect.objectContaining({
      baseUrl: "https://api.example.com/v1",
      api: "openai-completions",
    }));
    expect(unregisterProvider).not.toHaveBeenCalled();
  });

  // See change: refresh-models-on-provider-change (D4, review B1).
  it("overlapping reloads: the second resolves only after the first's registration completed", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();
    let releaseDiscovery!: () => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((res) => {
        releaseDiscovery = () => res(new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }));
      }),
    ) as any;
    writeProvidersJson(tmpHome, { "my-llm": { baseUrl: "https://api.example.com/v1", apiKey: "k" } });

    const first = mod.reloadProviders(pi);
    let secondDone = false;
    const second = mod.reloadProviders(pi).then((d) => { secondDone = true; return d; });
    await new Promise((r) => setTimeout(r, 20));
    expect(registerProvider).not.toHaveBeenCalled();
    expect(secondDone).toBe(false); // must not report "no diff" while my-llm is still registering

    releaseDiscovery();
    await first;
    await second;
    expect(registerProvider).toHaveBeenCalledTimes(1);
  });

  // See change: refresh-models-on-provider-change (D4, review r2 B1).
  it("a re-sync overlapping session_start re-enrichment waits for it to finish", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();
    const handlers = new Map<string, (e: any, c: any) => any>();
    pi.on = vi.fn((ev: string, h: any) => { handlers.set(ev, h); });
    writeProvidersJson(tmpHome, { "my-llm": { baseUrl: "https://api.example.com/v1", apiKey: "k" } });

    mod.activate(pi);
    await mod.reloadProviders(pi); // startup discovery (instant stub) drained via the chain
    const before = registerProvider.mock.calls.length;

    let releaseDiscovery!: () => void;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((res) => {
        releaseDiscovery = () => res(new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }));
      }),
    ) as any;
    const sessionStart = handlers.get("session_start")!({}, { modelRegistry: { find: () => null } });
    await new Promise((r) => setTimeout(r, 10));

    // Selector open through the production handler; the registry reflects
    // whatever pi.registerProvider has applied so far.
    const registry = {
      authStorage: { reload: vi.fn() },
      getAvailable: vi.fn(() =>
        registerProvider.mock.calls.length > before
          ? [{ provider: "my-llm", id: "m1", name: "m1" }]
          : [],
      ),
      refresh: vi.fn(async () => ({ aborted: false, errors: new Map() })),
    };
    const handler = createCommandHandler({ setSessionName: vi.fn(), getSessionName: () => "s" } as any, "sess-1", {
      getModelRegistry: () => registry,
      reloadProviders: async () => { await mod.reloadProviders(pi); },
    });
    let answered = false;
    const resync = handler.handle({ type: "request_models", sessionId: "sess-1" } as any)
      .then((r: any) => { answered = true; return r; });
    await new Promise((r) => setTimeout(r, 20));
    expect(answered).toBe(false); // no models_list while re-enrichment is mid-discovery

    releaseDiscovery();
    await sessionStart;
    const res: any = await resync;
    expect(res.type).toBe("models_list");
    expect(res.models.map((m: any) => m.id)).toEqual(["m1"]);
  });

  // See change: refresh-models-on-provider-change (D3/D5, review B3).
  it("selector open through the real re-sync: unchanged providers.json makes no network request", async () => {
    const mod = await importFresh();
    const { pi } = makeMockPi();
    writeProvidersJson(tmpHome, { "my-llm": { baseUrl: "https://api.example.com/v1", apiKey: "k" } });
    await mod.reloadProviders(pi); // initial registration (discovery allowed: real diff)
    (globalThis.fetch as any).mockClear();

    const seen: any[] = [];
    const registry = {
      authStorage: { reload: vi.fn() },
      getAvailable: vi.fn(() => []),
      refresh: vi.fn(async (o: any) => { seen.push(o); return { aborted: false, errors: new Map() }; }),
    };
    const handler = createCommandHandler({ setSessionName: vi.fn(), getSessionName: () => "s" } as any, "sess-1", {
      getModelRegistry: () => registry,
      reloadProviders: async () => { await mod.reloadProviders(pi); },
    });
    const res: any = await handler.handle({ type: "request_models", sessionId: "sess-1" } as any);

    expect(res.type).toBe("models_list");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(seen).toEqual([{ allowNetwork: false }]);
  });

  // ── auth pre-registration race fix (see change: fix-flow-agent-model-resolution) ──
  it("preRegisterProviderAuth registers the apiKey synchronously with NO models", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    mod.preRegisterProviderAuth(pi, "home-proxy", {
      baseUrl: "http://localhost:20128/v1",
      apiKey: "sk-literal-key",
      api: "anthropic-messages",
    });

    // Exactly one call, carrying auth, and crucially WITHOUT `models` so the
    // existing catalog is left untouched (storeProviderRequestConfig only).
    expect(registerProvider).toHaveBeenCalledTimes(1);
    const [name, config] = registerProvider.mock.calls[0];
    expect(name).toBe("home-proxy");
    expect(config.baseUrl).toBe("http://localhost:20128/v1");
    expect(config.api).toBe("anthropic-messages");
    expect(config.apiKey).toBe("sk-literal-key");
    expect(config.models).toBeUndefined();
  });

  it("removes a provider when its entry disappears from providers.json", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);
    expect(registerProvider).toHaveBeenCalledTimes(1);

    writeProvidersJson(tmpHome, {});
    const diff = await mod.reloadProviders(pi);

    expect(diff.removed).toEqual(["my-llm"]);
    expect(diff.added).toEqual([]);
    expect(unregisterProvider).toHaveBeenCalledTimes(1);
    expect(unregisterProvider).toHaveBeenCalledWith("my-llm");
  });

  it("re-registers (unregister then register) when baseUrl changes", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://old.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);
    expect(registerProvider).toHaveBeenCalledTimes(1);

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://new.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    const diff = await mod.reloadProviders(pi);

    expect(diff.changed).toEqual(["my-llm"]);
    // unregister must be called before the second register
    const unregOrder = unregisterProvider.mock.invocationCallOrder[0];
    const reg2Order = registerProvider.mock.invocationCallOrder[1];
    expect(unregOrder).toBeLessThan(reg2Order);
    expect(registerProvider).toHaveBeenLastCalledWith(
      "my-llm",
      expect.objectContaining({ baseUrl: "https://new.example.com/v1" }),
    );
  });

  it("unchanged providers.json produces no register/unregister calls on second reload", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);
    registerProvider.mockClear();
    unregisterProvider.mockClear();

    const diff = await mod.reloadProviders(pi);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(registerProvider).not.toHaveBeenCalled();
    expect(unregisterProvider).not.toHaveBeenCalled();
  });

  it("malformed providers.json returns empty diff and does not throw", async () => {
    const mod = await importFresh();
    const { pi } = makeMockPi();

    const dir = join(tmpHome, ".pi", "agent");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "providers.json"), "not valid json {", "utf-8");

    await expect(mod.reloadProviders(pi)).resolves.toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  it("treats apiKey change as 'changed'", async () => {
    const mod = await importFresh();
    const { pi, registerProvider, unregisterProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "old", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "new", api: "openai-completions" },
    });
    const diff = await mod.reloadProviders(pi);
    expect(diff.changed).toEqual(["my-llm"]);
    expect(unregisterProvider).toHaveBeenCalledWith("my-llm");
  });

  it("treats api type change as 'changed'", async () => {
    const mod = await importFresh();
    const { pi } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);

    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://x", apiKey: "k", api: "openai-responses" },
    });
    const diff = await mod.reloadProviders(pi);
    expect(diff.changed).toEqual(["my-llm"]);
  });

  // ── input capability default (see change: enable-image-input-custom-providers) ─────
  // Every discovered model must advertise `input: ["text", "image"]` so pi-ai does
  // not strip pasted images via `downgradeUnsupportedImages` before the request
  // leaves the bridge. This guards both the initial-registration path and the
  // reloadProviders() re-register path.

  it("discovered models default to input: [\"text\", \"image\"] on fresh register", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    writeProvidersJson(tmpHome, {
      "my-llm": {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      },
    });

    await mod.reloadProviders(pi);

    expect(registerProvider).toHaveBeenCalledTimes(1);
    const [, config] = registerProvider.mock.calls[0];
    expect(Array.isArray(config.models)).toBe(true);
    expect(config.models.length).toBe(2); // two models from the fetch stub
    for (const m of config.models) {
      expect(m.input).toEqual(["text", "image"]);
    }
  });

  it("re-registered models (after reload diff) retain input: [\"text\", \"image\"]", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // Initial register
    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://old.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    await mod.reloadProviders(pi);

    // Change baseUrl → triggers unregister + re-register
    writeProvidersJson(tmpHome, {
      "my-llm": { baseUrl: "https://new.example.com/v1", apiKey: "k", api: "openai-completions" },
    });
    const diff = await mod.reloadProviders(pi);
    expect(diff.changed).toEqual(["my-llm"]);

    // Second registerProvider call is the re-register; must carry same input default
    expect(registerProvider).toHaveBeenCalledTimes(2);
    const [, secondConfig] = registerProvider.mock.calls[1];
    for (const m of secondConfig.models) {
      expect(m.input).toEqual(["text", "image"]);
    }
  });

  // ── model metadata enrichment (see change: enrich-custom-provider-model-metadata) ──
  // registerEntry() resolves per-model metadata via enrichModelMetadata() which
  // consults pi-ai's bundled catalog. These tests verify the end-to-end path:
  // discovered id → catalog match → registerProvider receives accurate fields.

  it("captures ctx.modelRegistry from session_start and re-registers providers with enriched metadata", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // Capture the session_start handler registered by activate().
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
    pi.on = vi.fn((event: string, handler: any) => {
      handlers.set(event, handler);
    });

    // Fake pi's ModelRegistry. `find(provider, id)` returns Opus 4.7's real
    // metadata for the anthropic entry, simulating what pi passes via
    // ctx.modelRegistry at session_start.
    const fakeRegistry = {
      find: vi.fn((provider: string, id: string) => {
        if (provider === "anthropic" && id === "claude-opus-4-7") {
          return {
            contextWindow: 1_000_000,
            maxTokens: 128_000,
            reasoning: true,
            cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
            input: ["text", "image"],
          };
        }
        return null;
      }),
    };

    // Fetch mock advertises the real model id.
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: "cc/claude-opus-4-7" }] }),
        { status: 200 },
      ),
    ) as any;

    writeProvidersJson(tmpHome, {
      proxy: {
        baseUrl: "https://llmproxy.example.com/v1",
        apiKey: "sk-test",
        api: "anthropic-messages",
      },
    });

    // 1) activate() registers the provider BEFORE ctx.modelRegistry is
    //    available. It now issues TWO calls per provider: an auth-only
    //    pre-registration (no `models`, closes the spawn race — see change:
    //    fix-flow-agent-model-resolution) followed by the fire-and-forget
    //    registerEntry() fallback-enriched call.
    mod.activate(pi);
    // Wait a microtask for the fire-and-forget registerEntry inside activate.
    await new Promise((r) => setTimeout(r, 10));

    expect(registerProvider).toHaveBeenCalledTimes(2);
    // call[0] = auth-only pre-registration: carries the apiKey, no models.
    const preRegCall = registerProvider.mock.calls[0];
    expect(preRegCall[0]).toBe("proxy");
    expect(preRegCall[1].models).toBeUndefined();
    // call[1] = registerEntry() fallback path (no captured registry yet).
    const firstCall = registerProvider.mock.calls[1];
    expect(firstCall[1].models[0].contextWindow).toBe(200_000); // fallback

    // 2) Fire session_start with ctx.modelRegistry — the handler captures it
    //    and re-registers all known providers with the enriched metadata.
    const sessionStartHandler = handlers.get("session_start");
    expect(sessionStartHandler).toBeDefined();
    await sessionStartHandler!({ type: "session_start" }, {
      ui: { notify: vi.fn() },
      modelRegistry: fakeRegistry,
      model: undefined,
    });

    // 3) The re-registration should have issued a third registerProvider
    //    call, this time with the catalog-enriched metadata.
    expect(registerProvider).toHaveBeenCalledTimes(3);
    const secondCall = registerProvider.mock.calls[2];
    const [name, config] = secondCall;
    expect(name).toBe("proxy");
    const [opus] = config.models;
    expect(opus.id).toBe("cc/claude-opus-4-7");
    expect(opus.contextWindow).toBe(1_000_000);
    expect(opus.maxTokens).toBe(128_000);
    expect(opus.reasoning).toBe(true);
    expect(opus.cost.input).toBe(5);
    expect(opus.cost.output).toBe(25);
    // Probed with prefix-stripped bare id under `anthropic`.
    expect(fakeRegistry.find).toHaveBeenCalledWith("anthropic", "claude-opus-4-7");
  });

  it("without modelRegistry (never captured), discovered models fall back to api-appropriate defaults", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // No session_start fires — modelRegistryRef stays null and the probe is
    // null, so every discovered id hits the fallback table.
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: "cc/claude-opus-4-7" }] }),
        { status: 200 },
      ),
    ) as any;

    writeProvidersJson(tmpHome, {
      proxy: {
        baseUrl: "https://llmproxy.example.com/v1",
        apiKey: "sk-test",
        api: "anthropic-messages",
      },
    });

    await mod.reloadProviders(pi);

    const [, config] = registerProvider.mock.calls[0];
    const [opus] = config.models;
    // anthropic-messages fallback: 200k / 64k / no reasoning / zero cost / text+image.
    expect(opus.contextWindow).toBe(200_000);
    expect(opus.maxTokens).toBe(64_000);
    expect(opus.reasoning).toBe(false);
    expect(opus.input).toEqual(["text", "image"]);
  });

  // ── custom-flag race regression (see change: fix-custom-provider-flag-race) ──
  // The bridge's first `providers_list` push fires from `session_start`
  // shortly after `activate()` kicked off async `registerEntry()` calls.
  // The catalogue's `custom: true` flag MUST be set on that first push,
  // even when each provider's `/v1/models` endpoint hasn't responded yet —
  // otherwise custom providers from `~/.pi/agent/providers.json` leak into
  // Settings → Provider Authentication → API Keys (where they don't belong;
  // the LLM Providers section already manages them).

  it("custom flag is set on first providers_list push, before discoverModels resolves (regression)", async () => {
    const mod = await importFresh();
    const { pi } = makeMockPi();

    // Capture event handlers so we can fire model_select to set modelRegistryRef.
    const handlers = new Map<string, (event: any, ctx: any) => Promise<void> | void>();
    pi.on = vi.fn((event: string, handler: any) => { handlers.set(event, handler); });

    // Stub fetch with a never-resolving promise — simulates a slow or
    // unreachable /v1/models endpoint. The fix's correctness does NOT depend
    // on this resolving; the synchronous `lastRegistered.set` runs before the
    // await.
    let resolveFetch: ((value: Response) => void) | null = null;
    globalThis.fetch = vi.fn(
      () => new Promise<Response>((r) => { resolveFetch = r; }),
    ) as any;

    // Two custom providers. With the fix, both end up in lastRegistered
    // synchronously when activate() iterates them.
    writeProvidersJson(tmpHome, {
      proxy: { baseUrl: "https://example.com/v1", apiKey: "sk-test", api: "openai-completions" },
      "your-llmproxy": { baseUrl: "https://example2.com/v1", apiKey: "sk-test", api: "openai-completions" },
    });

    // activate() fires registerEntry async (.catch(() => {})). The synchronous
    // body runs to the first await before yielding.
    mod.activate(pi);

    // Capture modelRegistry via a model_select event — buildProviderCatalogue()
    // returns [] when modelRegistryRef is null. We use model_select rather
    // than session_start because session_start would re-register every entry
    // (also stalling on the never-resolving fetch).
    const fakeRegistry = {
      find: () => null,
      getAll: () => [
        { provider: "proxy", id: "some-model" },
        { provider: "your-llmproxy", id: "some-model" },
        { provider: "deepseek", id: "deepseek-chat" },
      ],
      getProviderDisplayName: (id: string) => id,
      authStorage: {
        getOAuthProviders: () => [],
        getAuthStatus: () => ({ configured: false }),
        get: () => undefined,
      },
    };
    const modelSelectHandler = handlers.get("model_select");
    expect(modelSelectHandler).toBeDefined();
    await modelSelectHandler!({}, { modelRegistry: fakeRegistry, model: undefined });

    // Build the catalogue while discovery is still in flight. With the fix,
    // both custom providers are flagged custom: true. Without it, lastRegistered
    // is still empty (the post-await `lastRegistered.set` never runs because
    // fetch never resolves) and the flags are missing.
    const cat = mod.buildProviderCatalogue();

    expect(cat.find((c) => c.id === "proxy")?.custom).toBe(true);
    expect(cat.find((c) => c.id === "your-llmproxy")?.custom).toBe(true);
    // Built-in pi-ai providers must remain unflagged.
    expect(cat.find((c) => c.id === "deepseek")?.custom).toBeUndefined();

    // Cleanup: settle the dangling fetches so the test process doesn't leak.
    if (resolveFetch) (resolveFetch as (value: Response) => void)(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  });

  it("discovered unknown model falls back to api-appropriate defaults (openai-completions → 128k)", async () => {
    const mod = await importFresh();
    const { pi, registerProvider } = makeMockPi();

    // Default beforeEach fetch stub returns `m1` and `m2` — neither exists in catalog.
    writeProvidersJson(tmpHome, {
      "my-llm": {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      },
    });

    await mod.reloadProviders(pi);

    const [, config] = registerProvider.mock.calls[0];
    for (const m of config.models) {
      expect(m.contextWindow).toBe(128_000);
      expect(m.maxTokens).toBe(16_384);
      expect(m.reasoning).toBe(false);
      expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      expect(m.input).toEqual(["text", "image"]);
    }
  });
});

/**
 * pi 0.84.0 BREAKING: `ModelRegistry.refresh()` accepts `ModelsRefreshOptions`
 * and returns `Promise<ModelsRefreshResult>` ({ aborted, errors }) instead of
 * discarding cancellation and provider errors.
 *
 * Two hazards this pins:
 *   1. refresh() is now ASYNC. The old `registry.refresh(); registry.getAvailable()`
 *      sequence read the catalogue BEFORE the refresh resolved.
 *   2. Its result carries per-provider errors that a bare `catch {}` discarded,
 *      so a partly-failed refresh was reported as a success.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #E12, #E13, #X1, #X2, #X3).
 */
describe("model registry refresh — 0.84.x options/result contract", () => {

  function makePi() {
    return {
      setSessionName: vi.fn(),
      getSessionName: () => "s",
    } as any;
  }

  /** A registry whose refresh() honours the 0.84.x async options/result shape. */
  function makeRegistry(opts: {
    result?: { aborted: boolean; errors: ReadonlyMap<string, Error> };
    throws?: Error;
    stall?: boolean;
    models?: any[];
  }) {
    const seenOptions: any[] = [];
    let resolveStall: (() => void) | undefined;
    const available = opts.models ?? [];
    const registry = {
      authStorage: { reload: vi.fn() },
      getAvailable: vi.fn(() => available),
      refresh: vi.fn(async (options?: any) => {
        seenOptions.push(options);
        if (opts.throws) throw opts.throws;
        if (opts.stall) {
          await new Promise<void>((res) => {
            resolveStall = res;
            options?.signal?.addEventListener?.("abort", () => res());
          });
          return { aborted: true, errors: new Map() };
        }
        return opts.result ?? { aborted: false, errors: new Map() };
      }),
    };
    return { registry, seenOptions, releaseStall: () => resolveStall?.() };
  }

  async function requestModels(registry: any) {
    const handler = createCommandHandler(makePi(), "sess-1", {
      getModelRegistry: () => registry,
    });
    return handler.handle({ type: "request_models", sessionId: "sess-1" } as any);
  }

  it("E12 / X2: a provider error is surfaced, not swallowed by a bare catch", async () => {
    const errors = new Map([["openai", new Error("catalog 503")]]);
    const { registry } = makeRegistry({ result: { aborted: false, errors } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await requestModels(registry);

    expect(registry.refresh).toHaveBeenCalled();
    // The failing provider must be named somewhere observable.
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/openai/);
    warn.mockRestore();
  });

  it("X1: the provider identity reaches the log, not just a generic failure", async () => {
    const errors = new Map([["anthropic", new Error("boom")]]);
    const { registry } = makeRegistry({ result: { aborted: false, errors } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await requestModels(registry);

    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/anthropic/);
    expect(logged).toMatch(/boom/);
    warn.mockRestore();
  });

  it("E12: the catalogue is read AFTER the refresh resolves, not before", async () => {
    const order: string[] = [];
    const registry = {
      authStorage: { reload: vi.fn() },
      getAvailable: vi.fn(() => {
        order.push("getAvailable");
        return [];
      }),
      refresh: vi.fn(async () => {
        order.push("refresh:start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("refresh:end");
        return { aborted: false, errors: new Map() };
      }),
    };

    await requestModels(registry);

    expect(order).toEqual(["refresh:start", "refresh:end", "getAvailable"]);
  });

  it("request_models re-syncs providers.json BEFORE refreshing (heals a missed credentials_updated)", async () => {
    // See change: refresh-models-on-provider-change (D1).
    const order: string[] = [];
    const { registry } = makeRegistry({});
    registry.refresh.mockImplementationOnce(async () => {
      order.push("refresh");
      return { aborted: false, errors: new Map() };
    });
    const handler = createCommandHandler(makePi(), "sess-1", {
      getModelRegistry: () => registry,
      reloadProviders: async () => { order.push("reloadProviders"); },
    });
    await handler.handle({ type: "request_models", sessionId: "sess-1" } as any);
    expect(order).toEqual(["reloadProviders", "refresh"]);
  });

  it("request_models still answers when the providers re-sync throws (degraded, not broken)", async () => {
    const { registry } = makeRegistry({ models: [{ provider: "openai", id: "gpt-5", name: "gpt-5" }] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = createCommandHandler(makePi(), "sess-1", {
      getModelRegistry: () => registry,
      reloadProviders: async () => { throw new Error("providers.json unreadable"); },
    });
    const res: any = await handler.handle({ type: "request_models", sessionId: "sess-1" } as any);
    expect(res.type).toBe("models_list");
    expect(res.models).toHaveLength(1);
    expect(registry.refresh).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("request_models (selector open) refreshes locally, never via remote catalogues", async () => {
    // See change: refresh-models-on-provider-change (D3).
    const { registry, seenOptions } = makeRegistry({});
    await requestModels(registry);
    expect(seenOptions[0]).toEqual({ allowNetwork: false });
  });

  it("E13: refresh is passed a ModelsRefreshOptions object", async () => {
    const { registry, seenOptions } = makeRegistry({});
    await requestModels(registry);
    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]).toBeTypeOf("object");
    expect(seenOptions[0]).not.toBeNull();
  });

  it("E13: a credentials reload scopes the refresh to the providers it touched", async () => {
    // The bridge's credentials_updated path knows exactly which providers the
    // providers.json diff added/changed. Refreshing every catalogue because one
    // credential moved re-fetches unrelated providers for nothing.
    const { registry, seenOptions } = makeRegistry({});
    const diff = { added: ["openai"], removed: ["dead"], changed: ["anthropic"] };

    await refreshAfterCredentialsReload(registry, diff);

    expect(seenOptions[0].providers).toEqual(["openai", "anthropic"]);
    // A removed provider has no catalogue to refresh.
    expect(seenOptions[0].providers).not.toContain("dead");
  });

  it("an empty providers.json diff still runs a local full refresh (credential-only change)", async () => {
    // auth.json changes (OAuth login, built-in provider key) leave the diff
    // empty; the changed provider is unknown, so availability must be
    // recomputed for all — locally, never via remote catalogues.
    // See change: refresh-models-on-provider-change (D2).
    const { registry, seenOptions } = makeRegistry({});
    const diff = { added: [] as string[], removed: ["dead"], changed: [] as string[] };

    await refreshAfterCredentialsReload(registry, diff);

    expect(seenOptions).toHaveLength(1);
    expect(seenOptions[0]).toEqual({ allowNetwork: false });
  });

  it("X2: a throwing refresh does not crash the handler and is reported", async () => {
    const { registry } = makeRegistry({ throws: new Error("registry exploded") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res: any = await requestModels(registry);

    expect(res?.type).toBe("models_list");
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/registry exploded/);
    warn.mockRestore();
  });

  it("X3: aborting a stalled refresh stops it and reports the aborted outcome", async () => {
    // Fault injection: the refresh hangs until its AbortSignal fires.
    const { registry, seenOptions } = makeRegistry({ stall: true });
    const controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const pending = reportRefresh(registry.refresh({ signal: controller.signal }));
    // Nothing resolves until we abort.
    controller.abort();
    const result = await pending;

    expect(seenOptions[0].signal).toBe(controller.signal);
    expect(result?.aborted).toBe(true);
    expect(refreshFullySucceeded(result)).toBe(false);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/abort/i);
    warn.mockRestore();
  });

  it("X3: an aborted refresh is distinguishable from a successful one", async () => {
    const { registry } = makeRegistry({
      result: { aborted: true, errors: new Map() },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await requestModels(registry);

    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toMatch(/abort/i);
    warn.mockRestore();
  });
});

/**
 * pi 0.84.0 advanced custom-model sampling: `samplingParams` must survive the
 * hop from `models.json` into the metadata handed to `pi.registerProvider`.
 * Both this path and the server's internal registry whitelist fields
 * explicitly, so an un-forwarded field is silently dropped.
 *
 * See change: update-pi-core-0-84-adopt-apis (task 8.3).
 */
describe("samplingParams passthrough (pi 0.84.x)", () => {
  it("forwards samplingParams from the native entry into model metadata", async () => {
    const { metadataFromNative } = (await import("../provider-register.js")) as never as {
      metadataFromNative: (n: unknown, api?: string) => Record<string, unknown>;
    };
    const meta = metadataFromNative(
      { id: "qwen", provider: "my-vllm", samplingParams: { top_k: 40, thinking_token_budget: 2048 } },
      "openai-completions",
    );
    expect(meta.samplingParams).toEqual({ top_k: 40, thinking_token_budget: 2048 });
  });

  it("omits samplingParams entirely when the native entry declares none", async () => {
    const { metadataFromNative } = (await import("../provider-register.js")) as never as {
      metadataFromNative: (n: unknown, api?: string) => Record<string, unknown>;
    };
    const meta = metadataFromNative({ id: "m", provider: "p" }, "openai-completions");
    expect("samplingParams" in meta).toBe(false);
  });
});
