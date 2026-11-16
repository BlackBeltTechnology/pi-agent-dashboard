import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProbeLookupAll, setProbeSelfPort } from "../package/provider-probe.js";
import { clearProviderHealth, getAllProviderHealth } from "../routes/provider-health-cache.js";
import { registerProviderRoutes } from "../routes/provider-routes.js";

const PROVIDERS_DIR = join(homedir(), ".pi", "agent");
const PROVIDERS_PATH = join(PROVIDERS_DIR, "providers.json");
const PUBLIC_ADDR = [{ address: "93.184.216.34", family: 4 as const }];

// Pass-through network guard — we're testing the endpoint contract, not auth
const allowGuard = async () => {};

function makeApp() {
  const app = Fastify();
  registerProviderRoutes(app, { networkGuard: allowGuard as any });
  return app;
}

describe("POST /api/providers/test", () => {
  let originalFetch: typeof globalThis.fetch;
  let providersBackup: string | null = null;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    try { providersBackup = readFileSync(PROVIDERS_PATH, "utf-8"); } catch { providersBackup = null; }
    // Fixture hosts do not resolve; give the provider egress vet a public answer.
    setProbeLookupAll(async () => PUBLIC_ADDR);
    setProbeSelfPort(() => null);
    clearProviderHealth();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setProbeLookupAll(null);
    setProbeSelfPort(() => null);
    vi.useRealTimers();
    vi.restoreAllMocks();
    try {
      if (providersBackup !== null) writeFileSync(PROVIDERS_PATH, providersBackup);
      else rmSync(PROVIDERS_PATH, { force: true });
    } catch {}
    clearProviderHealth();
  });

  function seed(providers: Record<string, unknown>): void {
    mkdirSync(PROVIDERS_DIR, { recursive: true });
    writeFileSync(PROVIDERS_PATH, JSON.stringify({ providers }));
  }

  async function test(payload: Record<string, unknown>) {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/providers/test", payload });
    await app.close();
    return res.json() as Record<string, unknown>;
  }

  function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    globalThis.fetch = vi.fn(impl) as any;
  }

  it("400 when body is invalid", async () => {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: "not-json",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400 when baseUrl missing", async () => {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: { apiKey: "sk-abc", api: "openai-completions" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.error).toMatch(/baseUrl/);
    await app.close();
  });

  it("400 when api missing", async () => {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: { baseUrl: "https://x", apiKey: "sk" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("happy path: probe returns ok with modelCount", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 }),
    );
    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-abc",
        api: "openai-completions",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.modelCount).toBe(2);
    expect(body.sample).toEqual(["m1", "m2"]);
    await app.close();
  });

  it("401 upstream: returns ok=false with status", async () => {
    mockFetch(async () => new Response("bad key", { status: 401 }));
    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-bad",
        api: "openai-completions",
      },
    });
    // Our endpoint always returns 200 with the structured result
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(false);
    expect(body.status).toBe(401);
    await app.close();
  });

  it("missing $ENV_VAR: returns ok=false without hitting upstream", async () => {
    delete process.env.PROBE_ROUTE_MISSING;
    // The `$ENV` ref must be saved at this Base URL to reach the env lookup (secret binding).
    seed({ env: { baseUrl: "https://x", apiKey: "$PROBE_ROUTE_MISSING", api: "openai-completions" } });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: {
        baseUrl: "https://x",
        apiKey: "$PROBE_ROUTE_MISSING",
        api: "openai-completions",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/PROBE_ROUTE_MISSING/);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("response never echoes the apiKey", async () => {
    mockFetch(async () => new Response("bad key xyz-secret-abc", { status: 401 }));
    const app = makeApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: {
        baseUrl: "https://api.example.com/v1",
        apiKey: "xyz-secret-abc",
        api: "openai-completions",
      },
    });
    expect(res.payload).not.toContain("xyz-secret-abc");
    await app.close();
  });
  // -- NET-04: secret binding + egress (test-plan E93, E94, E96, E110, E135, X30) --
  // See change: close-local-listener-and-egress-gaps (design D7).

  const CHANGED = "Re-enter the API key to test a changed Base URL";
  const BOUND = "Environment-variable keys can only be tested with the Base URL saved with them";

  it("*** with a changed Base URL is refused with no request (E93)", async () => {
    seed({ p: { baseUrl: "https://api.example.com/v1", apiKey: "sk-saved", api: "openai-completions" } });
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    for (const baseUrl of ["https://evil.example/v1", "https://api.example.com:8443/v1", "http://api.example.com/v1", "https://api.example.com/v1/models"]) {
      expect(await test({ name: "p", baseUrl, apiKey: "***", api: "openai-completions" }), baseUrl).toEqual({ ok: false, error: CHANGED });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("*** with a trailing-slash / upper-case-host variant of the saved Base URL probes with the saved key", async () => {
    seed({ p: { baseUrl: "https://api.example.com/v1", apiKey: "sk-saved", api: "openai-completions" } });
    const fetchSpy = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    const body = await test({ name: "p", baseUrl: "HTTPS://API.Example.com/v1/", apiKey: "***", api: "openai-completions" });
    expect(body.ok).toBe(true);
    expect((fetchSpy.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer sk-saved");
  });

  it("invalid / non-http Base URLs are refused before anything else (E94)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    for (const baseUrl of ["not a url", "/v1"]) {
      expect(await test({ baseUrl, apiKey: "sk", api: "openai-completions" }), baseUrl).toEqual({ ok: false, error: "Base URL is not a valid URL" });
    }
    for (const baseUrl of ["ftp://h/", "file:///etc"]) {
      expect(await test({ baseUrl, apiKey: "sk", api: "openai-completions" }), baseUrl).toEqual({ ok: false, error: "Base URL must use http or https" });
    }
    // invalid URL wins over the secret-binding refusal
    seed({ p: { baseUrl: "https://api.example.com/v1", apiKey: "sk-saved" } });
    expect(await test({ name: "p", baseUrl: "not a url", apiKey: "***", api: "openai-completions" })).toEqual({ ok: false, error: "Base URL is not a valid URL" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refusal precedence: binding before env-unset and before the target vet (E96)", async () => {
    delete process.env.NET04_UNSET;
    seed({ p: { baseUrl: "https://api.example.com/v1", apiKey: "sk-saved" } });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    setProbeSelfPort(() => 18999);
    expect(await test({ baseUrl: "https://x.example/v1", apiKey: "$NET04_UNSET", api: "openai-completions" })).toEqual({ ok: false, error: BOUND });
    expect(await test({ name: "p", baseUrl: "http://169.254.169.254/", apiKey: "***", api: "openai-completions" })).toEqual({ ok: false, error: CHANGED });
    expect(await test({ baseUrl: "http://127.0.0.1:18999", apiKey: "$NET04_UNSET", api: "openai-completions" })).toEqual({ ok: false, error: BOUND });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("literal key + metadata / own-dashboard target is refused; response never carries `status`; health cached (NET-04)", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    setProbeSelfPort(() => 18999);
    const meta = await test({ name: "n", baseUrl: "http://169.254.169.254/latest", apiKey: "sk-literal", api: "openai-completions" });
    expect(meta).toEqual({ ok: false, error: "provider target is a link-local or metadata address" });
    expect(getAllProviderHealth().n).toMatchObject({ ok: false, error: "provider target is a link-local or metadata address" });
    expect(await test({ baseUrl: "http://127.0.0.1:18999", apiKey: "sk-literal", api: "openai-completions" })).toEqual({
      ok: false,
      error: "provider target is this dashboard",
    });
    expect(await test({ baseUrl: "http://[fe80::1]/", apiKey: "sk-literal", api: "openai-completions" })).toEqual({
      ok: false,
      error: "provider target is a link-local or metadata address",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("local / LAN providers are still probed (E110)", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    globalThis.fetch = fetchSpy as any;
    setProbeLookupAll(async (h) => (h === "localhost" ? [{ address: "127.0.0.1", family: 4 }] : PUBLIC_ADDR));
    for (const baseUrl of ["http://localhost:11434/v1", "http://192.168.1.10:8080", "http://10.0.0.5", "http://172.16.0.9"]) {
      expect((await test({ baseUrl, apiKey: "sk", api: "openai-completions" })).ok, baseUrl).toBe(true);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("DNS failure and refused TCP are { ok:false, error } with no status key (E135)", async () => {
    setProbeLookupAll(async () => {
      throw new Error("ENOTFOUND");
    });
    const dns = await test({ baseUrl: "https://nx.example/v1", apiKey: "sk", api: "openai-completions" });
    expect(dns.ok).toBe(false);
    expect("status" in dns).toBe(false);
    setProbeLookupAll(null);
    const tcp = await test({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "sk", api: "openai-completions" });
    expect(tcp.ok).toBe(false);
    expect("status" in tcp).toBe(false);
  });

  it("a stalled DNS lookup ends at the 8 s budget: { ok:false, error }, no status, no request (X30)", async () => {
    vi.useFakeTimers();
    setProbeLookupAll(() => new Promise(() => {}));
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;
    const app = makeApp();
    await app.ready();
    const pending = app.inject({
      method: "POST",
      url: "/api/providers/test",
      payload: { name: "stall", baseUrl: "https://stalled.example/v1", apiKey: "sk", api: "openai-completions" },
    });
    await vi.advanceTimersByTimeAsync(8000);
    const body = (await pending).json() as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect("status" in body).toBe(false);
    expect(getAllProviderHealth().stall?.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });
});
