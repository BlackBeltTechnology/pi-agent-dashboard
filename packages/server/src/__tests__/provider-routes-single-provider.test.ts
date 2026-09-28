/**
 * Single-provider writes — `PATCH` / `DELETE /api/providers/:name`
 * (custom-provider-crud delta; test-plan E11–E16, X10–X12, P1, P2 and the
 * "editing one provider does not clear another's pill" scenario).
 *
 * `PUT /api/providers` replaces the whole map and awaits a probe per provider;
 * a per-edit endpoint must upsert ONE entry, preserve every non-provider
 * top-level key (`roles` / `rolePresets` / `activePreset` — the
 * highest-consequence invariant), never interleave read with write, and never
 * block the response on the upstream probe.
 *
 * See change: redesign-providers-settings-page (D3).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerProviderRoutes } from "../routes/provider-routes.js";
import { clearProviderHealth, getAllProviderHealth, setProviderHealth } from "../routes/provider-health-cache.js";
import { startStalledUpstream } from "./stalled-upstream.js";

const fsState = vi.hoisted(() => ({ interruptRename: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    // X11 — interrupt exactly between tmp-write and rename; delegating unless flagged.
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsState.interruptRename) throw new Error("interrupted between write and rename");
      return actual.renameSync(...args);
    },
  };
});

vi.mock("../model-proxy/registry-singleton.js", () => ({
  // Isolates the probe-count invariant (P2) from real model discovery and lets
  // the broadcast/refresh tests (task 4.7) assert the call.
  refreshModelRegistry: vi.fn().mockResolvedValue(undefined),
}));

import { refreshModelRegistry } from "../model-proxy/registry-singleton.js";

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const PROVIDERS_DIR = join(homedir(), ".pi", "agent");
const REFUSED_BASE = "http://127.0.0.1:9/v1"; // refused instantly; never probed successfully

let backup: string | null = null;
beforeEach(() => {
  try { backup = readFileSync(PROVIDERS_PATH, "utf-8"); } catch { backup = null; }
  clearProviderHealth();
  vi.mocked(refreshModelRegistry).mockClear();
});
afterEach(() => {
  fsState.interruptRename = false;
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
  clearProviderHealth();
});

function writeFixture(providers: Record<string, any>, extra: Record<string, unknown> = {}): string {
  const bytes = JSON.stringify({ providers, ...extra }, null, 2) + "\n";
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  writeFileSync(PROVIDERS_PATH, bytes);
  return bytes;
}

function readFullFile(): any {
  return JSON.parse(readFileSync(PROVIDERS_PATH, "utf-8"));
}

async function buildApp(port = 8000) {
  const app = Fastify({ logger: false });
  const networkGuard = async () => {};
  const piGateway = { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any;
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  registerProviderRoutes(app, { networkGuard, piGateway, port });
  await app.ready();
  return { app, piGateway };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await wait(10);
  }
  throw new Error("waitFor: condition never became true");
}

describe("PATCH /api/providers/:name — field semantics (E11)", () => {
  it("empty body preserves every stored field", async () => {
    writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" } });
    const { app } = await buildApp();

    const res = await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: {} });

    expect(res.statusCode).toBe(200);
    expect(readFullFile().providers.proxy).toEqual({
      baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions",
    });
    await app.close();
  });

  it("omitted baseUrl and apiKey preserve stored values when only api is patched", async () => {
    writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" } });
    const { app } = await buildApp();

    const res = await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { api: "openai-responses" } });

    expect(res.statusCode).toBe(200);
    const proxy = readFullFile().providers.proxy;
    expect(proxy.baseUrl).toBe(REFUSED_BASE);
    expect(proxy.apiKey).toBe("sk-real");
    expect(proxy.api).toBe("openai-responses");
    await app.close();
  });

  it("masked sentinel preserves the stored key and is never persisted", async () => {
    writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" } });
    const { app } = await buildApp();

    const res = await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { apiKey: "***" } });

    expect(res.statusCode).toBe(200);
    const stored = readFullFile().providers.proxy;
    expect(stored.apiKey).toBe("sk-real");
    expect(JSON.stringify(readFullFile())).not.toContain("***");
    await app.close();
  });

  it("explicit non-sentinel apiKey replaces the stored key", async () => {
    writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" } });
    const { app } = await buildApp();

    const res = await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { apiKey: "sk-new" } });

    expect(res.statusCode).toBe(200);
    expect(readFullFile().providers.proxy.apiKey).toBe("sk-new");
    await app.close();
  });
});

describe("PATCH /api/providers/:name — upsert and addressing (E12, E13, E14)", () => {
  it("E12: PATCH creates an absent provider and leaves the other untouched", async () => {
    writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" } });
    const { app } = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/vllm",
      payload: { baseUrl: "http://127.0.0.1:9/vllm", apiKey: "sk-vllm", api: "openai-completions" },
    });

    expect(res.statusCode).toBe(200);
    const providers = readFullFile().providers;
    expect(providers.vllm).toEqual({ baseUrl: "http://127.0.0.1:9/vllm", apiKey: "sk-vllm", api: "openai-completions" });
    expect(providers.proxy.apiKey).toBe("sk-real");
    await app.close();
  });

  it("E13: blank name in the path (%20) is rejected and the file is byte-unchanged", async () => {
    const before = writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real" } });
    const { app } = await buildApp();

    const res = await app.inject({ method: "PATCH", url: "/api/providers/%20", payload: { apiKey: "sk-x" } });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(before);
    await app.close();
  });

  it("E13: DELETE with a blank name (%20) is rejected and the file is byte-unchanged", async () => {
    const before = writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real" } });
    const { app } = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/providers/%20" });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(before);
    await app.close();
  });

  it("E14: a name containing '/' is percent-encoded in the path and used verbatim as the JSON key", async () => {
    writeFixture({ "a/b": { baseUrl: REFUSED_BASE, apiKey: "sk-old", api: "openai-completions" } });
    const { app } = await buildApp();

    const patch = await app.inject({ method: "PATCH", url: "/api/providers/a%2Fb", payload: { apiKey: "sk-new" } });
    expect(patch.statusCode).toBe(200);
    expect(readFullFile().providers["a/b"].apiKey).toBe("sk-new");

    const del = await app.inject({ method: "DELETE", url: "/api/providers/a%2Fb" });
    expect(del.statusCode).toBe(200);
    expect(readFullFile().providers["a/b"]).toBeUndefined();
    await app.close();
  });
});

describe("non-provider key preservation (E15) — the highest-consequence invariant", () => {
  it("roles, rolePresets and activePreset survive a PATCH and a DELETE deep-equal", async () => {
    const roles = { ops: { model: "x", description: "d" } };
    const rolePresets = [{ name: "preset-a", roles: ["ops"] }];
    const before = writeFixture(
      {
        proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" },
        vllm: { baseUrl: REFUSED_BASE, apiKey: "sk-vllm", api: "openai-completions" },
      },
      { roles, rolePresets, activePreset: "preset-a" },
    );
    const { app } = await buildApp();

    const patch = await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { apiKey: "sk-new" } });
    expect(patch.statusCode).toBe(200);
    let file = readFullFile();
    expect(file.roles).toEqual(roles);
    expect(file.rolePresets).toEqual(rolePresets);
    expect(file.activePreset).toBe("preset-a");

    const del = await app.inject({ method: "DELETE", url: "/api/providers/vllm" });
    expect(del.statusCode).toBe(200);
    file = readFullFile();
    expect(file.roles).toEqual(roles);
    expect(file.rolePresets).toEqual(rolePresets);
    expect(file.activePreset).toBe("preset-a");
    // And the untouched provider is still there.
    expect(file.providers.proxy.apiKey).toBe("sk-new");
    expect(file.providers.vllm).toBeUndefined();
    // bytes-level sanity: fixture shape was not rebuilt from a providers-only body
    expect(Object.keys(JSON.parse(before))).toContain("roles");
    await app.close();
  });
});

describe("DELETE /api/providers/:name (E16)", () => {
  it("deleting an absent name succeeds and leaves remaining entries unchanged", async () => {
    const before = writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real" } });
    const { app } = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/providers/ghost" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).success).toBe(true);
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(before);
    await app.close();
  });

  it("delete removes only the named provider", async () => {
    writeFixture({
      proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real" },
      vllm: { baseUrl: REFUSED_BASE, apiKey: "sk-vllm" },
    });
    const { app } = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/providers/proxy" });

    expect(res.statusCode).toBe(200);
    const providers = readFullFile().providers;
    expect(providers.proxy).toBeUndefined();
    expect(providers.vllm).toEqual({ baseUrl: REFUSED_BASE, apiKey: "sk-vllm" });
    await app.close();
  });
});

describe("concurrency and atomicity (X10, X11)", () => {
  it("X10: two simultaneous writes to different providers both land", async () => {
    writeFixture({
      proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-1", api: "openai-completions" },
      vllm: { baseUrl: REFUSED_BASE, apiKey: "sk-2", api: "openai-completions" },
    });
    const { app } = await buildApp();

    const [a, b] = await Promise.all([
      app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { apiKey: "sk-proxy-new" } }),
      app.inject({ method: "PATCH", url: "/api/providers/vllm", payload: { apiKey: "sk-vllm-new" } }),
    ]);

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const providers = readFullFile().providers;
    expect(providers.proxy.apiKey).toBe("sk-proxy-new");
    expect(providers.vllm.apiKey).toBe("sk-vllm-new");
    expect(providers.proxy.baseUrl).toBe(REFUSED_BASE);
    expect(providers.vllm.baseUrl).toBe(REFUSED_BASE);
    await app.close();
  });

  it("X11: an interrupted write (throw between tmp-write and rename) leaves the previous content", async () => {
    const before = writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-old" } });
    const { app } = await buildApp();

    fsState.interruptRename = true;
    try {
      const res = await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { apiKey: "sk-new" } });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
      expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(before);
    } finally {
      fsState.interruptRename = false;
    }
    await app.close();
  });
});

describe("guards inherited from PUT (task 4.3, X12)", () => {
  it("X12: self-pointing baseUrl is rejected with RECURSIVE_PROXY and the file is unchanged", async () => {
    const before = writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real" } });
    const { app } = await buildApp(8000);

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/proxy",
      payload: { baseUrl: "http://localhost:8000/v1" },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).code).toBe("RECURSIVE_PROXY");
    expect(readFileSync(PROVIDERS_PATH, "utf-8")).toBe(before);
    await app.close();
  });

  it("masked sentinel on an ABSENT provider is rejected and not persisted", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    const { app } = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/api/providers/fresh",
      payload: { baseUrl: REFUSED_BASE, apiKey: "***", api: "openai-completions" },
    });

    expect(res.statusCode).toBe(400);
    // No entry created — the file may not exist at all, and if it does it
    // must not carry the sentinel or a `fresh` entry.
    let raw: string | null = null;
    try { raw = readFileSync(PROVIDERS_PATH, "utf-8"); } catch { /* file absent */ }
    if (raw !== null) {
      expect(raw).not.toContain('***');
      expect(JSON.parse(raw).providers?.fresh).toBeUndefined();
    }
    await app.close();
  });
});

describe("health cache retention (task 4.4)", () => {
  it("PATCH retains another provider's cached health and refreshes only the touched one", async () => {
    writeFixture({
      proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" },
      vllm: { baseUrl: REFUSED_BASE, apiKey: "sk-vllm", api: "openai-completions" },
    });
    const vllmHealth = { ok: true, modelCount: 7, testedAt: 12345 };
    setProviderHealth("proxy", { ok: true, modelCount: 3, testedAt: 1 });
    setProviderHealth("vllm", vllmHealth);
    const { app } = await buildApp();

    const res = await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { apiKey: "sk-new" } });
    expect(res.statusCode).toBe(200);

    // The touched provider's stale pill must not survive untouched: the
    // detached probe (refused upstream) replaces it. The OTHER pill is intact.
    await waitFor(() => getAllProviderHealth().proxy?.testedAt !== 1);
    expect(getAllProviderHealth().vllm).toEqual(vllmHealth);
    expect(getAllProviderHealth().proxy?.ok).toBe(false);
    await app.close();
  });

  it("DELETE drops only the deleted provider's health", async () => {
    writeFixture({
      proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real", api: "openai-completions" },
      vllm: { baseUrl: REFUSED_BASE, apiKey: "sk-vllm", api: "openai-completions" },
    });
    const vllmHealth = { ok: true, modelCount: 7, testedAt: 12345 };
    setProviderHealth("proxy", { ok: true, modelCount: 3, testedAt: 1 });
    setProviderHealth("vllm", vllmHealth);
    const { app } = await buildApp();

    const res = await app.inject({ method: "DELETE", url: "/api/providers/proxy" });
    expect(res.statusCode).toBe(200);
    await wait(100);

    expect(getAllProviderHealth().proxy).toBeUndefined();
    expect(getAllProviderHealth().vllm).toEqual(vllmHealth);
    await app.close();
  });
});

describe("bridge notification and registry refresh (task 4.7)", () => {
  it("PATCH broadcasts credentials_updated and refreshes the model registry", async () => {
    writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real" } });
    const { app, piGateway } = await buildApp();

    await app.inject({ method: "PATCH", url: "/api/providers/proxy", payload: { apiKey: "sk-new" } });

    expect(piGateway.broadcast).toHaveBeenCalledWith({ type: "credentials_updated" });
    expect(refreshModelRegistry).toHaveBeenCalled();
    await app.close();
  });

  it("DELETE broadcasts credentials_updated and refreshes the model registry", async () => {
    writeFixture({ proxy: { baseUrl: REFUSED_BASE, apiKey: "sk-real" } });
    const { app, piGateway } = await buildApp();

    await app.inject({ method: "DELETE", url: "/api/providers/proxy" });

    expect(piGateway.broadcast).toHaveBeenCalledWith({ type: "credentials_updated" });
    expect(refreshModelRegistry).toHaveBeenCalled();
    await app.close();
  });
});

describe("the write does not block on the upstream probe (P1, P2 — task 4.5)", () => {
  it("P2: exactly one probe is issued for the touched provider only", async () => {
    let hits = 0;
    const counter = http.createServer(() => { hits++; });
    await new Promise<void>((resolve) => counter.listen(0, "127.0.0.1", resolve));
    const port = (counter.address() as import("node:net").AddressInfo).port;
    const base = `http://127.0.0.1:${port}/v1`;
    try {
      writeFixture({
        p1: { baseUrl: base, apiKey: "sk-1", api: "openai-completions" },
        p2: { baseUrl: base, apiKey: "sk-2", api: "openai-completions" },
        p3: { baseUrl: base, apiKey: "sk-3", api: "openai-completions" },
        p4: { baseUrl: base, apiKey: "sk-4", api: "openai-completions" },
        p5: { baseUrl: base, apiKey: "sk-5", api: "openai-completions" },
      });
      const { app } = await buildApp();

      const res = await app.inject({ method: "PATCH", url: "/api/providers/p3", payload: { apiKey: "sk-new" } });
      expect(res.statusCode).toBe(200);

      // Wait for the (single) probe to land, then a grace window for any
      // additional probe a whole-map probe would have fired.
      await waitFor(() => hits >= 1);
      await wait(400);
      expect(hits).toBe(1);
      await app.close();
    } finally {
      await new Promise<void>((resolve) => counter.close(() => resolve()));
    }
  });

  it("P1: with the upstream stalled, 20 PATCH responses stay p95 < 300 ms", async () => {
    const stalled = await startStalledUpstream();
    try {
      writeFixture({ slow: { baseUrl: stalled.url, apiKey: "sk-slow", api: "openai-completions" } });
      const { app } = await buildApp();

      const durations: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t0 = Date.now();
        const res = await app.inject({
          method: "PATCH",
          url: "/api/providers/slow",
          payload: { apiKey: `sk-${i}` },
        });
        durations.push(Date.now() - t0);
        expect(res.statusCode).toBe(200);
      }
      durations.sort((a, b) => a - b);
      const p95 = durations[Math.min(durations.length - 1, Math.ceil(0.95 * durations.length) - 1)];
      expect(p95).toBeLessThan(300);
      await app.close();
    } finally {
      await stalled.close();
    }
  }, 30_000);
});
