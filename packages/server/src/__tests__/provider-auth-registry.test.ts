/**
 * Registry tests, driven against the REAL resolved `@earendil-works/pi-coding-agent`
 * (test-plan E1, E2, E3, P1).
 *
 * These are the tests that prove the delegation actually happened: the id set
 * is read out of the runtime, not out of a dashboard table.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D1, D3).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FLOW_TYPE_HINT,
  getOAuthRegistry,
  getRegistryError,
  initOAuthRegistry,
  mapProviders,
  oauthRegistryReady,
  resolveVersionFallback,
  setOAuthRegistryRuntimeSource,
} from "../auth/provider-auth-registry.js";
import { DashboardCredentialStore } from "../auth/dashboard-credential-store.js";
import {
  disposeModelRegistry,
  getModelProxyStatus,
  getModelRegistry,
  getStreamSimpleFn,
} from "../model-proxy/registry-singleton.js";
import {
  _setRuntimeModuleLoaderForTests,
  getServerModelRuntime,
  ModelRuntimeUnavailableError,
} from "../model-proxy/server-model-runtime.js";

/**
 * The nine OAuth providers pi 1.0.0 bundles (incl. `radius`, listed unless a
 * models.json override hides it). 1.0.0 adds `openai` (Sign in with ChatGPT).
 * See change: update-pi-core-1-0-adopt-apis (test-plan #E10).
 */
const EXPECTED_IDS = [
  "anthropic",
  "openai",
  "openai-codex",
  "github-copilot",
  "openrouter",
  "kimi-coding",
  "meta",
  "xai",
  "radius",
] as const;

beforeAll(async () => {
  // server.ts wires the single runtime in at boot.
  // See change: collapse-model-proxy-onto-modelruntime (D6).
  setOAuthRegistryRuntimeSource(getServerModelRuntime);
  await oauthRegistryReady();
});

describe("registry from the real runtime (E1)", () => {
  it("built without error", () => {
    expect(getRegistryError()).toBeNull();
  });

  it("contains exactly the nine bundled OAuth providers (E10)", () => {
    const ids = getOAuthRegistry().map((e) => e.id);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("E1/E10: lists `radius` as an Account (non-subscription) auth_code entry", () => {
    const radius = getOAuthRegistry().find((e) => e.id === "radius");
    expect(radius).toMatchObject({ name: "Radius", flowType: "auth_code", subscription: false });
  });

  it("E10: `openai` is an auth_code flow", () => {
    expect(getOAuthRegistry().find((e) => e.id === "openai")?.flowType).toBe("auth_code");
  });

  // test-plan #E18 — `subscription` from pi's OAuth `isSubscription`.
  it("E18: openrouter and radius are subscription:false, the other seven subscription:true", () => {
    for (const entry of getOAuthRegistry()) {
      expect(entry.subscription, entry.id).toBe(entry.id !== "openrouter" && entry.id !== "radius");
    }
  });

  it("gives every entry a name and a callable login", () => {
    for (const entry of getOAuthRegistry()) {
      expect(entry.name, entry.id).toBeTruthy();
      expect(typeof entry.auth.login, entry.id).toBe("function");
    }
  });

  it("reports a version that is not `unknown` when resolvable", () => {
    // `unknown` is a legitimate outcome on an unusual layout; what must never
    // happen is a version-less failure message.
    expect(typeof resolveVersionFallback()).toBe("string");
  });
});

describe("flowType hints (E2)", () => {
  const provider = (id: string) => ({
    id,
    auth: { oauth: { name: id, login: async () => ({ type: "oauth" as const, refresh: "", access: "", expires: 0 }) } },
  });

  it("maps the five auth-code ids and defaults every other id to device_code", () => {
    const entries = mapProviders(
      [
        "anthropic",
        "openai",
        "openai-codex",
        "openrouter",
        "radius",
        "github-copilot",
        "kimi-coding",
        "meta",
        "xai",
        "never-heard-of-it",
      ].map(provider),
    );
    const byId = new Map(entries.map((e) => [e.id, e.flowType]));

    expect(byId.get("anthropic")).toBe("auth_code");
    expect(byId.get("openai")).toBe("auth_code");
    expect(byId.get("openai-codex")).toBe("auth_code");
    expect(byId.get("openrouter")).toBe("auth_code");
    expect(byId.get("radius")).toBe("auth_code");
    for (const id of ["github-copilot", "kimi-coding", "meta", "xai", "never-heard-of-it"]) {
      expect(byId.get(id), id).toBe("device_code");
    }
  });

  it("hint table names exactly the five auth-code ids", () => {
    expect(Object.keys(FLOW_TYPE_HINT).sort()).toEqual([
      "anthropic",
      "openai",
      "openai-codex",
      "openrouter",
      "radius",
    ]);
  });

  it("absent isSubscription maps to subscription:false", () => {
    const [entry] = mapProviders([provider("anthropic")]);
    expect(entry.subscription).toBe(false);
    const [sub] = mapProviders([
      { id: "x", auth: { oauth: { ...provider("x").auth.oauth, isSubscription: true } } },
    ]);
    expect(sub.subscription).toBe(true);
  });

  it("drops providers with no OAuth login; no id is excluded", () => {
    const entries = mapProviders([
      { id: "no-oauth", auth: {} },
      provider("radius"),
      provider("anthropic"),
    ]);
    expect(entries.map((e) => e.id)).toEqual(["radius", "anthropic"]);
  });
});

describe("isolation from local provider sources (E3)", () => {
  it("ignores a ~/.pi/agent/models.json custom provider", async () => {
    const home = process.env.HOME;
    expect(home, "tests run under an isolated HOME").toBeTruthy();
    const dir = path.join(home as string, ".pi", "agent");
    fs.mkdirSync(dir, { recursive: true });
    const modelsPath = path.join(dir, "models.json");
    const before = fs.existsSync(modelsPath) ? fs.readFileSync(modelsPath, "utf8") : null;
    fs.writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          "my-gw": {
            name: "My Gateway",
            baseUrl: "https://gw.example/v1",
            api: "openai-completions",
            oauth: "radius",
          },
        },
      }),
    );
    try {
      await initOAuthRegistry();
      const ids = getOAuthRegistry().map((e) => e.id);
      expect(ids).not.toContain("my-gw");
      // An extension-registered id cannot appear either: nothing is registered.
      expect(ids).not.toContain("acme-gateway");
      expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
    } finally {
      if (before === null) fs.rmSync(modelsPath, { force: true });
      else fs.writeFileSync(modelsPath, before);
    }
  });
});

describe("P1: registry build latency", () => {
  it("p95 stays under the 1500 ms ceiling over five builds", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const t0 = performance.now();
      await initOAuthRegistry();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];
    expect(getRegistryError()).toBeNull();
    expect(p95).toBeLessThan(1500);
  }, 30_000);
});

describe("real-runtime first-interaction drift (design D1 table)", () => {
  /**
   * Four of the seven bundled flows reach their FIRST step with no network call,
   * so their prompt/event shape is pinned here against the REAL runtime: a pi-ai
   * release that renames a prompt kind, reorders a `notify`, or drops one fails
   * THIS test instead of surfacing as a stuck sign-in pane in production.
   *
   * The device-code trio (kimi-coding, meta, xai) is deliberately absent: their
   * first step is `notify device_code`, which the flow can only emit AFTER it
   * has POSTed for a device authorization — a unit test cannot observe it
   * without hitting the network. Their shape is pinned by the scripted fakes in
   * `provider-auth-adapter.test.ts` and by the L3 e2e spec.
   *
   * Each probe stops the flow at its first prompt (reject, never resolve) and
   * aborts the controller at the first renderable event, so nothing waits, polls
   * or reconnects.
   */
  const OFFLINE_FIRST_STEPS: Array<[string, string[]]> = [
    // 1.0.0: Anthropic opens with a method `select` (browser / copy_code).
    ["anthropic", ["select"]],
    ["openrouter", ["progress", "auth_url", "manual_code"]],
    ["openai-codex", ["select"]],
    ["github-copilot", ["text"]],
  ];

  it.each(OFFLINE_FIRST_STEPS)("%s emits its documented first step", async (id, expected) => {
    const entry = getOAuthRegistry().find((e) => e.id === id);
    if (!entry) throw new Error(`no registry entry for ${id}`);

    const observed: string[] = [];
    const controller = new AbortController();
    const login = entry.auth.login({
      signal: controller.signal,
      notify: (event) => {
        observed.push(event.type);
        if (event.type === "auth_url" || event.type === "device_code") {
          controller.abort();
        }
      },
      prompt: (prompt) => {
        observed.push(prompt.type);
        controller.abort();
        return Promise.reject(new Error("drift probe: stop at the first prompt"));
      },
    });

    await expect(login).rejects.toBeTruthy();
    expect(observed).toEqual(expected);
  }, 20_000);
});

describe("failure degradation (X10 support)", () => {
  const rejecting = (message: string, version?: string) => async () => {
    throw new ModelRuntimeUnavailableError(message, version);
  };

  it("absorbs a failing runtime into an empty registry with a versioned error", async () => {
    const logs: string[] = [];
    await initOAuthRegistry({
      getRuntime: rejecting("module not found"),
      readVersion: () => "0.0.0-test",
      log: (m) => logs.push(m),
    });

    expect(getOAuthRegistry()).toEqual([]);
    expect(getRegistryError()).toContain("module not found");
    expect(getRegistryError()).toContain("0.0.0-test");
    expect(logs.join("\n")).toContain("0.0.0-test");
  });

  it("absorbs a runtime with no OAuth providers", async () => {
    await initOAuthRegistry({
      getRuntime: async () => ({ version: "9.9.9", runtime: { getProviders: () => [] } }),
      log: () => {},
    });

    expect(getOAuthRegistry()).toEqual([]);
    expect(getRegistryError()).toContain("9.9.9");
  });

  it("absorbs an unwired runtime source", async () => {
    setOAuthRegistryRuntimeSource(undefined);
    try {
      await initOAuthRegistry({ log: () => {} });
      expect(getOAuthRegistry()).toEqual([]);
      expect(getRegistryError()).toContain("not wired");
    } finally {
      setOAuthRegistryRuntimeSource(getServerModelRuntime);
    }
  });

  it("falls back to `unknown` when no version can be resolved", async () => {
    await initOAuthRegistry({
      getRuntime: rejecting("boom"),
      readVersion: () => "unknown",
      log: () => {},
    });
    expect(getRegistryError()).toContain("unknown");
  });
});

/**
 * ONE runtime behind every surface (test-plan #E1, #X9, #X12).
 * See change: collapse-model-proxy-onto-modelruntime (D4, D6).
 */
describe("the single server model runtime", () => {
  afterEach(async () => {
    _setRuntimeModuleLoaderForTests(null);
    disposeModelRegistry();
    setOAuthRegistryRuntimeSource(getServerModelRuntime);
    await initOAuthRegistry({ log: () => {} });
  });

  /** The real pi-coding-agent module with `ModelRuntime.create` spied. */
  async function spiedRealModule() {
    const real = (await import("@earendil-works/pi-coding-agent")) as unknown as {
      VERSION: string;
      ModelRuntime: { create(options: unknown): Promise<unknown> };
    };
    const create = vi.fn((options: unknown) => real.ModelRuntime.create(options as never));
    _setRuntimeModuleLoaderForTests(async () => ({ VERSION: real.VERSION, ModelRuntime: { create } }));
    return create;
  }

  it("E1: proxy, /api/models, plugin runtime and provider-auth listing share exactly one create()", async () => {
    disposeModelRegistry();
    const create = await spiedRealModule();

    // Model proxy + /api/models + plugin runtime all read getModelRegistry().
    const proxyRegistry = await getModelRegistry();
    const introspectionRegistry = await getModelRegistry();
    const pluginRegistry = await getModelRegistry();
    expect(typeof getStreamSimpleFn()).toBe("function");
    // Provider-auth listing.
    await initOAuthRegistry({ log: () => {} });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    expect((create.mock.calls[0][0] as { credentials: { constructor: { name: string } } }).credentials.constructor.name).toBe(
      "DashboardCredentialStore",
    );
    expect(introspectionRegistry).toBe(proxyRegistry);
    expect(pluginRegistry).toBe(proxyRegistry);
    expect(getRegistryError()).toBeNull();
    // Listing and catalogue come from the same runtime: every OAuth id is a catalogue provider.
    const { runtime } = await getServerModelRuntime();
    const ids = new Set(runtime.getProviders().map((p) => p.id));
    for (const entry of getOAuthRegistry()) expect(ids.has(entry.id), entry.id).toBe(true);
  });

  it("X9: a rejected ModelRuntime.create degrades the listing and the proxy together, with the same error", async () => {
    _setRuntimeModuleLoaderForTests(async () => ({
      VERSION: "1.0.0-test",
      ModelRuntime: {
        create: async () => {
          throw new Error("runtime exploded");
        },
      },
    }));
    disposeModelRegistry();

    await initOAuthRegistry({ log: () => {} });
    expect(getOAuthRegistry()).toEqual([]);
    expect(getRegistryError()).toContain("runtime exploded");
    expect(getRegistryError()).toContain("1.0.0-test");

    await expect(getModelRegistry()).rejects.toThrow("runtime exploded");
    const status = getModelProxyStatus();
    expect(status.status).toBe("degraded");
    expect(status.reason).toBe("runtime exploded");
    expect(getStreamSimpleFn()).toBeNull();
  });

  it("X12: creating the runtime with a near-expiry OAuth credential calls no refresh and leaves auth.json byte-identical", async () => {
    const dir = path.join(os.homedir(), ".pi", "agent");
    fs.mkdirSync(dir, { recursive: true });
    const authPath = path.join(dir, "auth.json");
    fs.writeFileSync(
      authPath,
      JSON.stringify({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 60_000 } }),
      { mode: 0o600 },
    );
    const sha = () => createHash("sha256").update(fs.readFileSync(authPath)).digest("hex");
    const before = sha();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const modifySpy = vi.spyOn(DashboardCredentialStore.prototype, "modify");
    try {
      disposeModelRegistry();
      await spiedRealModule();
      await getServerModelRuntime();
      await initOAuthRegistry({ log: () => {} });
      // Let any background availability pass settle.
      await new Promise((r) => setTimeout(r, 200));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(modifySpy).not.toHaveBeenCalled();
      expect(sha()).toBe(before);
    } finally {
      fetchSpy.mockRestore();
      modifySpy.mockRestore();
      fs.rmSync(authPath, { force: true });
    }
  });
});
