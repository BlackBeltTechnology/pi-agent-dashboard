/**
 * Startup registration of custom-provider models (pi resolves `--model` after
 * the extension factories settle). Covers test-plan E1–E10, P1–P3, X1.
 *
 * See change: register-custom-provider-models-at-activation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function importFresh() {
  vi.resetModules();
  const mod = (await import("../provider-register.js")) as typeof import("../provider-register.js");
  const cache = (await import("../provider-model-cache.js")) as typeof import("../provider-model-cache.js");
  return { mod, cache };
}

function makeMockPi() {
  const order: string[] = [];
  const registerProvider = vi.fn((name: string, cfg: any) => {
    order.push(`register:${name}:${cfg?.models ? cfg.models.map((m: any) => m.id).join(",") : "auth"}`);
  });
  const pi = {
    registerProvider,
    unregisterProvider: vi.fn(),
    events: { on: vi.fn(), emit: vi.fn() },
    on: vi.fn(),
  } as any;
  return { pi, registerProvider, order };
}

function writeProvidersJson(home: string, providers: Record<string, any>) {
  const dir = join(home, ".pi", "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "providers.json"), JSON.stringify({ providers }), "utf-8");
}

const PROXY = { baseUrl: "https://proxy.example/v1", apiKey: "sk-proxy", api: "openai-completions" };

function modelsResponse(ids: string[]) {
  return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 });
}

/** Model-bearing registrations for `name`, as id lists, in call order. */
function modelLists(registerProvider: any, name: string): string[][] {
  return registerProvider.mock.calls
    .filter((c: any[]) => c[0] === name && Array.isArray(c[1]?.models))
    .map((c: any[]) => c[1].models.map((m: any) => m.id));
}

function cachedIds(home: string, name: string): string[] | null {
  const f = join(home, ".pi", "dashboard", "custom-provider-models", `${encodeURIComponent(name)}.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf-8")).models.map((m: any) => m.id);
}

/** A fetch that never answers but rejects when its signal aborts. */
function hangingFetch(calls: string[]) {
  return vi.fn((url: string, init?: RequestInit) => {
    calls.push(String(url));
    return new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
    });
  });
}

describe("startup registration of custom-provider models", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.PROXY_KEY;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "provider-startup-"));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    if (originalKey === undefined) delete process.env.PROXY_KEY;
    else process.env.PROXY_KEY = originalKey;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("E1: a cached provider is registered with its models before any fetch; startup makes no fetch", async () => {
    writeProvidersJson(tmpHome, { proxy: PROXY });
    const { mod, cache } = await importFresh();
    cache.recordProviderModelCache("proxy", PROXY, [
      { id: "cc/a", advertised: {} },
      { id: "cc/b", advertised: {} },
    ]);
    const fetchCalls: string[] = [];
    globalThis.fetch = hangingFetch(fetchCalls) as any;
    const { pi, registerProvider } = makeMockPi();

    mod.activate(pi, ["node", "pi", "--model", "proxy/cc/a"]);
    // Synchronously registered, before the startup promise is even awaited.
    expect(modelLists(registerProvider, "proxy")[0]).toEqual(["cc/a", "cc/b"]);
    await mod.awaitStartupProviderModels();
    // Only the background refresh fetches; startup awaited nothing network-bound.
    expect(fetchCalls.length).toBeLessThanOrEqual(1);
    expect(modelLists(registerProvider, "proxy")).toEqual([["cc/a", "cc/b"]]);
  });

  it("E2: background discovery still runs for a cached provider and replaces list + cache", async () => {
    writeProvidersJson(tmpHome, { proxy: PROXY });
    const { mod, cache } = await importFresh();
    cache.recordProviderModelCache("proxy", PROXY, [
      { id: "cc/a", advertised: {} },
      { id: "cc/b", advertised: {} },
    ]);
    globalThis.fetch = vi.fn(async () => modelsResponse(["cc/a", "cc/c"])) as any;
    const { pi, registerProvider } = makeMockPi();

    mod.activate(pi, ["node", "pi"]);
    await mod.reloadProviders(pi); // serialized behind the startup chain → background settled
    expect(modelLists(registerProvider, "proxy")).toEqual([["cc/a", "cc/b"], ["cc/a", "cc/c"]]);
    expect(cachedIds(tmpHome, "proxy")).toEqual(["cc/a", "cc/c"]);
  });

  it("E3: startup target parsing table", async () => {
    const { mod } = await importFresh();
    const custom = ["proxy", "local"];
    const rows: Array<[string[], string | undefined]> = [
      [["--model", "proxy/cc/x"], "proxy"],
      [["--provider", "proxy", "--model", "cc/x"], "proxy"],
      [["--model", "PROXY/cc/x"], "proxy"],
      [["--model", "cc-x"], undefined],
      [["--model", "anthropic/claude-x"], undefined],
      [[], undefined],
    ];
    for (const [args, expected] of rows) {
      expect(mod.startupTargetProvider(["node", "pi", ...args], custom), args.join(" ")).toBe(expected);
    }
  });

  it("E3: exactly one live startup discovery only for the custom-provider targets", async () => {
    writeProvidersJson(tmpHome, { proxy: PROXY });
    const rows: Array<[string[], boolean]> = [
      [["--model", "proxy/cc/x"], true],
      [["--provider", "proxy", "--model", "cc/x"], true],
      [["--model", "PROXY/cc/x"], true],
      [["--model", "cc-x"], false],
      [["--model", "anthropic/claude-x"], false],
      [[], false],
    ];
    for (const [args, expectAwaited] of rows) {
      const { mod } = await importFresh();
      let calls = 0;
      // Startup-awaited discovery answers; background (if alone) never does.
      globalThis.fetch = vi.fn(async (_u: string, init?: RequestInit) => {
        calls++;
        return new Promise<Response>((res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
          setTimeout(() => res(modelsResponse(["cc/x"])), 5);
        });
      }) as any;
      const { pi, registerProvider } = makeMockPi();
      mod.activate(pi, ["node", "pi", ...args]);
      await mod.awaitStartupProviderModels();
      const lists = modelLists(registerProvider, "proxy");
      if (expectAwaited) {
        // Registered from the awaited startup discovery; it replaced (not added to) the background fetch.
        expect(lists, args.join(" ")).toEqual([["cc/x"]]);
        expect(calls, args.join(" ")).toBe(1);
      } else {
        expect(lists, args.join(" ")).toEqual([]);
      }
      await mod.reloadProviders(pi);
      rmSync(join(tmpHome, ".pi", "dashboard"), { recursive: true, force: true });
    }
  });

  it("E4: cache usability table — only a matching entry skips the startup fetch", async () => {
    process.env.PROXY_KEY = "env-key-1";
    const entry = { ...PROXY, apiKey: "$PROXY_KEY" };
    const variants: Array<[string, () => void, boolean]> = [
      ["matching", () => {}, true],
      ["baseUrl differs", () => writeProvidersJson(tmpHome, { proxy: { ...entry, baseUrl: "https://other/v1" } }), false],
      ["env key differs", () => { process.env.PROXY_KEY = "env-key-2"; }, false],
      ["empty models", () => {
        const f = join(tmpHome, ".pi", "dashboard", "custom-provider-models", "proxy.json");
        const raw = JSON.parse(readFileSync(f, "utf-8"));
        raw.models = [];
        writeFileSync(f, JSON.stringify(raw));
      }, false],
    ];
    for (const [label, mutate, usable] of variants) {
      process.env.PROXY_KEY = "env-key-1";
      writeProvidersJson(tmpHome, { proxy: entry });
      const { mod, cache } = await importFresh();
      cache.recordProviderModelCache("proxy", entry, [{ id: "cc/x", advertised: {} }]);
      mutate();
      const fetchCalls: string[] = [];
      globalThis.fetch = vi.fn(async (u: string) => {
        fetchCalls.push(u);
        return modelsResponse(["cc/live"]);
      }) as any;
      const { pi, registerProvider } = makeMockPi();
      mod.activate(pi, ["node", "pi", "--model", "proxy/cc/x"]);
      const firstSync = modelLists(registerProvider, "proxy")[0];
      await mod.awaitStartupProviderModels();
      if (usable) {
        expect(firstSync, label).toEqual(["cc/x"]);
      } else {
        expect(firstSync, label).toBeUndefined();
        expect(modelLists(registerProvider, "proxy")[0], label).toEqual(["cc/live"]);
        expect(fetchCalls.length, label).toBeGreaterThanOrEqual(1);
      }
      await mod.reloadProviders(pi);
      rmSync(join(tmpHome, ".pi", "dashboard"), { recursive: true, force: true });
    }
  });

  it("E5: a failed or empty discovery leaves the cache byte-identical; fallback registration still made", async () => {
    writeProvidersJson(tmpHome, { proxy: PROXY });
    for (const respond of [
      () => new Response("boom", { status: 500 }),
      () => modelsResponse([]),
    ]) {
      const { mod, cache } = await importFresh();
      cache.recordProviderModelCache("proxy", PROXY, [
        { id: "cc/a", advertised: {} },
        { id: "cc/b", advertised: {} },
      ]);
      const f = cache.providerModelCachePath("proxy");
      const before = readFileSync(f);
      globalThis.fetch = vi.fn(async () => respond()) as any;
      const { pi, registerProvider } = makeMockPi();
      mod.activate(pi, ["node", "pi"]);
      await mod.reloadProviders(pi);
      expect(readFileSync(f).equals(before)).toBe(true);
      // Background registration happened with today's fallback (`[]` ∪ native).
      expect(modelLists(registerProvider, "proxy").at(-1)).toEqual([]);
    }
  });

  it("E6: a cache-sourced registration never writes the cache", async () => {
    writeProvidersJson(tmpHome, { proxy: PROXY });
    const { mod, cache } = await importFresh();
    cache.recordProviderModelCache("proxy", PROXY, [{ id: "cc/a", advertised: {} }]);
    const f = cache.providerModelCachePath("proxy");
    const before = readFileSync(f);
    const mtime = statSync(f).mtimeMs;
    globalThis.fetch = hangingFetch([]) as any;
    const { pi, registerProvider } = makeMockPi();
    mod.activate(pi, ["node", "pi"]);
    await mod.awaitStartupProviderModels();
    expect(modelLists(registerProvider, "proxy")).toEqual([["cc/a"]]);
    expect(readFileSync(f).equals(before)).toBe(true);
    expect(statSync(f).mtimeMs).toBe(mtime);
  });

  it("E7: a forced refresh records the fresh list in the cache", async () => {
    writeProvidersJson(tmpHome, { proxy: PROXY });
    const { mod, cache } = await importFresh();
    globalThis.fetch = vi.fn(async () => modelsResponse(["cc/a"])) as any;
    const { pi } = makeMockPi();
    await mod.reloadProviders(pi); // initial registration (snapshot)
    cache.recordProviderModelCache("proxy", PROXY, [{ id: "cc/a", advertised: {} }]);
    globalThis.fetch = vi.fn(async () => modelsResponse(["cc/a", "cc/b"])) as any;
    await mod.reloadProviders(pi, { force: ["proxy"] });
    expect(cachedIds(tmpHome, "proxy")).toEqual(["cc/a", "cc/b"]);
  });

  it("E8: the written cache carries no credential, only a 16-hex fingerprint", async () => {
    process.env.PROXY_KEY = "env-SECRET-456";
    writeProvidersJson(tmpHome, {
      lit: { ...PROXY, apiKey: "sk-SECRET-123" },
      env: { ...PROXY, apiKey: "$PROXY_KEY" },
    });
    const { mod } = await importFresh();
    globalThis.fetch = vi.fn(async () => modelsResponse(["cc/a"])) as any;
    const { pi } = makeMockPi();
    await mod.reloadProviders(pi);
    for (const name of ["lit", "env"]) {
      const text = readFileSync(
        join(tmpHome, ".pi", "dashboard", "custom-provider-models", `${name}.json`),
        "utf-8",
      );
      expect(text).not.toContain("sk-SECRET-123");
      expect(text).not.toContain("env-SECRET-456");
      expect(text).not.toContain("PROXY_KEY");
      expect(JSON.parse(text).keyFingerprint).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("E9: concurrent writers for different providers keep both entries, mode 0600", async () => {
    const { cache } = await importFresh();
    const local = { baseUrl: "http://localhost:1/v1", apiKey: "k" };
    await Promise.all([
      Promise.resolve().then(() => cache.recordProviderModelCache("proxy", PROXY, [{ id: "p1", advertised: {} }])),
      Promise.resolve().then(() => cache.recordProviderModelCache("local", local, [{ id: "l1", advertised: {} }])),
      Promise.resolve().then(() => cache.recordProviderModelCache("proxy", PROXY, [{ id: "p1", advertised: {} }])),
    ]);
    expect(cachedIds(tmpHome, "proxy")).toEqual(["p1"]);
    expect(cachedIds(tmpHome, "local")).toEqual(["l1"]);
    if (process.platform !== "win32") {
      for (const n of ["proxy", "local"]) {
        expect(statSync(cache.providerModelCachePath(n)).mode & 0o777).toBe(0o600);
      }
    }
  });

  it("E10: a malformed cache file is tolerated and treated as uncached", async () => {
    writeProvidersJson(tmpHome, { proxy: PROXY });
    const dir = join(tmpHome, ".pi", "dashboard", "custom-provider-models");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "proxy.json"), "{not json");
    const { mod } = await importFresh();
    globalThis.fetch = vi.fn(async () => modelsResponse(["cc/live"])) as any;
    const { pi, registerProvider } = makeMockPi();
    expect(() => mod.activate(pi, ["node", "pi", "--model", "proxy/cc/live"])).not.toThrow();
    expect(modelLists(registerProvider, "proxy")).toEqual([]);
    await mod.awaitStartupProviderModels();
    expect(modelLists(registerProvider, "proxy")[0]).toEqual(["cc/live"]);
  });

  it("tryDiscoverModels honours a caller signal (task 1.3): startup discovery aborts promptly", async () => {
    writeProvidersJson(tmpHome, { down: { ...PROXY, baseUrl: "http://down/v1" } });
    const { mod } = await importFresh();
    const signals: AbortSignal[] = [];
    globalThis.fetch = vi.fn((_u: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    }) as any;
    vi.useFakeTimers();
    const { pi } = makeMockPi();
    mod.activate(pi, ["node", "pi", "--model", "down/x"]);
    const done = mod.awaitStartupProviderModels();
    await vi.advanceTimersByTimeAsync(mod.STARTUP_DISCOVERY_TIMEOUT_MS);
    await done;
    // The awaited discovery's fetch saw its signal aborted at the bound.
    expect(signals.some((s) => s.aborted)).toBe(true);
  });

  it("P1: a warm cache adds no startup latency", async () => {
    const providers = {
      a: { ...PROXY, baseUrl: "http://a/v1" },
      b: { ...PROXY, baseUrl: "http://b/v1" },
      c: { ...PROXY, baseUrl: "http://c/v1" },
    };
    writeProvidersJson(tmpHome, providers);
    const { mod, cache } = await importFresh();
    for (const [n, e] of Object.entries(providers)) cache.recordProviderModelCache(n, e, [{ id: "m", advertised: {} }]);
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(() => new Promise<Response>((r) => setTimeout(() => r(modelsResponse(["m"])), 10_000))) as any;
    const { pi } = makeMockPi();
    mod.activate(pi, ["node", "pi", "--model", "a/m"]);
    let resolved = false;
    mod.awaitStartupProviderModels().then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(49);
    expect(resolved).toBe(true);
  });

  it("P2: an uncached --model provider is bounded at 5000 ms", async () => {
    writeProvidersJson(tmpHome, { down: { ...PROXY, baseUrl: "http://down/v1" } });
    const { mod } = await importFresh();
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as any; // never answers, ignores abort
    const { pi } = makeMockPi();
    mod.activate(pi, ["node", "pi", "--model", "down/x"]);
    let resolved = false;
    mod.awaitStartupProviderModels().then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("P3: an unrelated slow provider adds no startup latency", async () => {
    writeProvidersJson(tmpHome, { down: { ...PROXY, baseUrl: "http://down/v1" } });
    const { mod } = await importFresh();
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as any;
    const { pi } = makeMockPi();
    mod.activate(pi, ["node", "pi"]);
    let resolved = false;
    mod.awaitStartupProviderModels().then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(49);
    expect(resolved).toBe(true);
  });

  it("X1: a failed startup discovery is logged, never fatal, and auth stays pre-registered", async () => {
    writeProvidersJson(tmpHome, { down: { ...PROXY, baseUrl: "http://down/v1" } });
    const { mod } = await importFresh();
    globalThis.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as any;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { pi, registerProvider } = makeMockPi();
    mod.activate(pi, ["node", "pi", "--model", "down/x"]);
    await expect(mod.awaitStartupProviderModels()).resolves.toBeUndefined();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('startup discovery for "down" failed'))).toBe(true);
    expect(registerProvider.mock.calls.some((c: any[]) => c[0] === "down" && c[1].models === undefined)).toBe(true);
    warn.mockRestore();
  });
});
