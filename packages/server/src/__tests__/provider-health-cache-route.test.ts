/**
 * Provider health cache: probe-on-save + Test caching + credential-free read.
 *
 * `PUT /api/providers` runs `probeProvider` for each saved provider and stores
 * `{ ok, status, error, modelCount, testedAt }` in an in-memory health cache.
 * `POST /api/providers/test` stores its result too. `GET /api/providers` folds
 * the cached health into its payload WITHOUT re-probing on read, and never
 * echoes any credential material. See change: surface-provider-health-in-settings.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as probeModule from "../package/provider-probe.js";
import { clearProviderHealth } from "../routes/provider-health-cache.js";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const PROVIDERS_DIR = join(homedir(), ".pi", "agent");

let backup: string | null = null;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  try { backup = readFileSync(PROVIDERS_PATH, "utf-8"); } catch { backup = null; }
  originalFetch = globalThis.fetch;
  clearProviderHealth();
});
afterEach(() => {
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function buildApp() {
  const app = Fastify({ logger: false });
  const networkGuard = async () => {};
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  registerProviderRoutes(app, { networkGuard });
  await app.ready();
  return app;
}

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as any;
}

async function getHealth(app: Awaited<ReturnType<typeof buildApp>>): Promise<Record<string, any>> {
  const res = await app.inject({ method: "GET", url: "/api/providers" });
  return JSON.parse(res.payload).health ?? {};
}

describe("provider health cache", () => {
  it("1.1 PUT /api/providers probes and caches { ok, status, modelCount, testedAt }", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    mockFetch(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 }),
    );
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { acme: { baseUrl: "https://api.example.com/v1", apiKey: "sk-abc", api: "openai-completions" } },
      }),
    });
    const health = await getHealth(app);
    expect(health.acme.ok).toBe(true);
    expect(health.acme.status).toBe(200);
    expect(health.acme.modelCount).toBe(2);
    expect(typeof health.acme.testedAt).toBe("number");
    await app.close();
  });

  it("1.1b PUT caches ok=false + status on an auth error", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    mockFetch(async () => new Response("invalid x-api-key", { status: 401 }));
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { acme: { baseUrl: "https://api.example.com/v1", apiKey: "sk-bad", api: "openai-completions" } },
      }),
    });
    const health = await getHealth(app);
    expect(health.acme.ok).toBe(false);
    expect(health.acme.status).toBe(401);
    expect(health.acme.error).toMatch(/invalid x-api-key/);
    await app.close();
  });

  it("1.2 POST /api/providers/test stores its result into the same cache", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    mockFetch(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }),
    );
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/providers/test",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "acme",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      }),
    });
    const health = await getHealth(app);
    expect(health.acme.ok).toBe(true);
    expect(health.acme.modelCount).toBe(1);
    await app.close();
  });

  it("1.3 GET returns cached health WITHOUT issuing a new probe", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    mockFetch(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }),
    );
    const probeSpy = vi.spyOn(probeModule, "probeProvider");
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { acme: { baseUrl: "https://api.example.com/v1", apiKey: "sk-abc", api: "openai-completions" } },
      }),
    });
    expect(probeSpy).toHaveBeenCalledTimes(1); // the save probe
    probeSpy.mockClear();

    await app.inject({ method: "GET", url: "/api/providers" });
    expect(probeSpy).not.toHaveBeenCalled(); // read must not re-probe
    await app.close();
  });

  it("stale health is cleared when a provider is re-saved with an unprobeable config", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    mockFetch(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }),
    );
    const app = await buildApp();
    // First save: probes green.
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { acme: { baseUrl: "https://api.example.com/v1", apiKey: "sk-abc", api: "openai-completions" } },
      }),
    });
    expect((await getHealth(app)).acme.ok).toBe(true);
    // Re-save with a blank baseUrl (unprobeable) — the old green must not survive.
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { acme: { baseUrl: "", apiKey: "sk-abc", api: "openai-completions" } },
      }),
    });
    expect((await getHealth(app)).acme).toBeUndefined();
    await app.close();
  });

  it("POST /test caches a key-resolution failure (no stale green survives)", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    delete process.env.PROBE_HEALTH_MISSING;
    mockFetch(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }),
    );
    const app = await buildApp();
    // Seed a green result via a save.
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { acme: { baseUrl: "https://api.example.com/v1", apiKey: "sk-abc", api: "openai-completions" } },
      }),
    });
    expect((await getHealth(app)).acme.ok).toBe(true);
    // Test with a missing $ENV key — resolution fails before probing; cache it.
    await app.inject({
      method: "POST",
      url: "/api/providers/test",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "acme",
        baseUrl: "https://api.example.com/v1",
        apiKey: "$PROBE_HEALTH_MISSING",
        api: "openai-completions",
      }),
    });
    const health = (await getHealth(app)).acme;
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/PROBE_HEALTH_MISSING/);
    await app.close();
  });

  it("1.4 cached health read carries no API key / credential field", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    mockFetch(async () => new Response("nope", { status: 401 }));
    const app = await buildApp();
    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { acme: { baseUrl: "https://api.example.com/v1", apiKey: "sk-super-secret-xyz", api: "openai-completions" } },
      }),
    });
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    expect(res.payload).not.toContain("sk-super-secret-xyz");
    const health = JSON.parse(res.payload).health.acme;
    expect(health).not.toHaveProperty("apiKey");
    expect(Object.keys(health).sort()).toEqual(["error", "ok", "status", "testedAt"]);
    await app.close();
  });
});
