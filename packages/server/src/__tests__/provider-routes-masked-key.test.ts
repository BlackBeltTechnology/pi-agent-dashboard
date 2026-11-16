/**
 * PUT /api/providers masked-sentinel guard.
 *
 * The masked sentinel `***` means "keep the existing key" — valid ONLY when the
 * named provider already exists in providers.json. When the provider is absent,
 * the merge MUST NOT persist the literal string `***` as the apiKey (which would
 * corrupt the credential). See change: fix-custom-provider-save-and-auth.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProbeLookupAll } from "../package/provider-probe.js";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_PATH = join(homedir(), ".pi", "agent", "providers.json");
const PROVIDERS_DIR = join(homedir(), ".pi", "agent");

let backup: string | null = null;
beforeEach(() => {
  try { backup = readFileSync(PROVIDERS_PATH, "utf-8"); } catch { backup = null; }
});
afterEach(() => {
  try {
    if (backup !== null) writeFileSync(PROVIDERS_PATH, backup);
    else rmSync(PROVIDERS_PATH, { force: true });
  } catch {}
});

async function buildApp(port = 8000) {
  const app = Fastify({ logger: false });
  const networkGuard = async () => {};
  mkdirSync(PROVIDERS_DIR, { recursive: true });
  registerProviderRoutes(app, { networkGuard, port });
  await app.ready();
  return app;
}

function readStored(): Record<string, any> {
  return JSON.parse(readFileSync(PROVIDERS_PATH, "utf-8")).providers ?? {};
}

describe("PUT /api/providers masked-sentinel guard", () => {
  it("masked key WITHOUT existing entry is not persisted as '***'", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    const app = await buildApp();

    await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { proxy: { baseUrl: "https://api.example.com/v1", apiKey: "***" } },
      }),
    });

    // Either rejected, or stored without the sentinel — never persisted as "***".
    let stored: Record<string, any> = {};
    try { stored = readStored(); } catch { /* file may not exist on reject */ }
    expect(stored.proxy?.apiKey).not.toBe("***");

    await app.close();
  });

  it("masked key WITH existing entry preserves the real key", async () => {
    mkdirSync(PROVIDERS_DIR, { recursive: true });
    writeFileSync(PROVIDERS_PATH, JSON.stringify({
      providers: { proxy: { baseUrl: "https://old.example.com/v1", apiKey: "sk-real" } },
    }));
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { proxy: { baseUrl: "https://new.example.com/v1", apiKey: "***" } },
      }),
    });

    expect(res.statusCode).not.toBe(400);
    const stored = readStored();
    expect(stored.proxy.apiKey).toBe("sk-real");
    expect(stored.proxy.baseUrl).toBe("https://new.example.com/v1");

    await app.close();
  });

  it("rejects a blank / whitespace-only provider name with 400 and persists nothing", async () => {
    rmSync(PROVIDERS_PATH, { force: true });
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/api/providers",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: { "   ": { baseUrl: "https://api.example.com/v1", apiKey: "sk-real" } },
      }),
    });

    expect(res.statusCode).toBe(400);
    let stored: Record<string, any> = {};
    try { stored = readStored(); } catch { /* file not written on reject */ }
    expect(Object.keys(stored)).toHaveLength(0);

    await app.close();
  });
});

// -- NET-04: `***` binds to the saved Base URL (test-plan E92, E95, E102, E103) --
// See change: close-local-listener-and-egress-gaps (design D7).

describe("POST /api/providers/test — `***` secret binding", () => {
  const SAVED = "https://api.example.com/v1";
  const CHANGED = "Re-enter the API key to test a changed Base URL";
  let originalFetch: typeof globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchSpy = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    setProbeLookupAll(async () => [{ address: "93.184.216.34", family: 4 }]);
    mkdirSync(PROVIDERS_DIR, { recursive: true });
    writeFileSync(PROVIDERS_PATH, JSON.stringify({ providers: { p: { baseUrl: SAVED, apiKey: "sk-live-secret", api: "openai-completions" } } }));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setProbeLookupAll(null);
  });

  async function test(payload: Record<string, unknown>) {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/providers/test", payload: { api: "openai-completions", apiKey: "***", ...payload } });
    await app.close();
    return res;
  }

  it("same Base URL: probes with the live key from the file; response never echoes it (E92)", async () => {
    const res = await test({ name: "p", baseUrl: SAVED });
    expect(res.json().ok).toBe(true);
    expect((fetchSpy.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer sk-live-secret");
    expect(res.payload).not.toContain("sk-live-secret");
  });

  it("no saved entry: 'No saved API key', no fetch (E95)", async () => {
    const res = await test({ name: "ghost", baseUrl: SAVED });
    expect(res.json()).toEqual({ ok: false, error: 'No saved API key for provider "ghost"' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("equal-after-normalisation variants probe with the saved key (E102)", async () => {
    for (const baseUrl of [
      "HTTPS://API.Example.com/v1",
      "https://api.example.com:443/v1",
      "https://api.example.com/v1/",
      "https://api.example.com/v1?x=1",
      "https://api.example.com/v1#f",
    ]) {
      fetchSpy.mockClear();
      expect((await test({ name: "p", baseUrl })).json().ok, baseUrl).toBe(true);
      expect(fetchSpy, baseUrl).toHaveBeenCalledTimes(1);
    }
  });

  it("unequal variants are refused with no request (E103)", async () => {
    for (const baseUrl of [
      "https://api.example.com/V1",
      "https://api.example.com:8443/v1",
      "http://api.example.com/v1",
      "https://api.example.com/v1/models",
      "https://api2.example.com/v1",
      "https://api.example.com.evil.net/v1",
      "https://u:p@api.example.com/v1",
      "https://api.example.com/v1//",
      "https://api.example.com./v1",
    ]) {
      const body = (await test({ name: "p", baseUrl })).json();
      expect(body, baseUrl).toEqual({ ok: false, error: CHANGED });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
