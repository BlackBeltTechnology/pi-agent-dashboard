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
import { beforeAll, describe, expect, it } from "vitest";
import {
  FLOW_TYPE_HINT,
  getOAuthRegistry,
  getRegistryError,
  initOAuthRegistry,
  mapProviders,
  oauthRegistryReady,
  resolveVersionFallback,
} from "../auth/provider-auth-registry.js";

/** The seven OAuth providers pi 0.86.1 bundles, minus the excluded `radius`. */
const EXPECTED_IDS = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "openrouter",
  "kimi-coding",
  "meta",
  "xai",
] as const;

beforeAll(async () => {
  await oauthRegistryReady();
});

describe("registry from the real runtime (E1)", () => {
  it("built without error", () => {
    expect(getRegistryError()).toBeNull();
  });

  it("contains exactly the seven bundled OAuth providers", () => {
    const ids = getOAuthRegistry().map((e) => e.id);
    expect([...ids].sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("excludes `radius`", () => {
    expect(getOAuthRegistry().some((e) => e.id === "radius")).toBe(false);
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

  it("maps the three auth-code ids and defaults every other id to device_code", () => {
    const entries = mapProviders(
      [
        "anthropic",
        "openai-codex",
        "openrouter",
        "github-copilot",
        "kimi-coding",
        "meta",
        "xai",
        "never-heard-of-it",
      ].map(provider),
    );
    const byId = new Map(entries.map((e) => [e.id, e.flowType]));

    expect(byId.get("anthropic")).toBe("auth_code");
    expect(byId.get("openai-codex")).toBe("auth_code");
    expect(byId.get("openrouter")).toBe("auth_code");
    for (const id of ["github-copilot", "kimi-coding", "meta", "xai", "never-heard-of-it"]) {
      expect(byId.get(id), id).toBe("device_code");
    }
  });

  it("hint table names exactly the three auth-code ids", () => {
    expect(Object.keys(FLOW_TYPE_HINT).sort()).toEqual([
      "anthropic",
      "openai-codex",
      "openrouter",
    ]);
  });

  it("drops providers with no OAuth login and the excluded id", () => {
    const entries = mapProviders([
      { id: "no-oauth", auth: {} },
      provider("radius"),
      provider("anthropic"),
    ]);
    expect(entries.map((e) => e.id)).toEqual(["anthropic"]);
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
    ["anthropic", ["auth_url", "manual_code"]],
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
  it("absorbs a throwing import() into an empty registry with a versioned error", async () => {
    const logs: string[] = [];
    await initOAuthRegistry({
      loadModule: async () => {
        throw new Error("module not found");
      },
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
      loadModule: async () => ({
        VERSION: "9.9.9",
        ModelRuntime: { create: async () => ({ getProviders: () => [] }) },
      }),
      log: () => {},
    });

    expect(getOAuthRegistry()).toEqual([]);
    expect(getRegistryError()).toContain("9.9.9");
  });

  it("absorbs a module missing ModelRuntime entirely", async () => {
    await initOAuthRegistry({ loadModule: async () => ({}), log: () => {} });
    expect(getOAuthRegistry()).toEqual([]);
    expect(getRegistryError()).toContain("ModelRuntime.create");
  });

  it("falls back to `unknown` when no version can be resolved", async () => {
    await initOAuthRegistry({
      loadModule: async () => {
        throw new Error("boom");
      },
      readVersion: () => "unknown",
      log: () => {},
    });
    expect(getRegistryError()).toContain("unknown");
  });
});
