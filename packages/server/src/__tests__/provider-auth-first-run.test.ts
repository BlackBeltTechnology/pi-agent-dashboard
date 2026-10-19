/**
 * First-run provider catalogue: with no bridge catalogue the api-key rows come
 * from the server's own pi runtime (the fallback), so onboarding can offer
 * providers before any session exists.
 *
 * Test-plan #E1 #E2 #E5 #E6 #E7 #E8 #E10 #E13 #X1 #X3 #X4.
 * See change: fix-provider-catalogue-first-run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _setRegistryRuntimeForTests,
  oauthRegistryReady,
  setOAuthRegistryRuntimeSource,
} from "../auth/provider-auth-registry.js";
import { getAuthStatus } from "../auth/provider-auth-storage.js";
import { getServerModelRuntime } from "../model-proxy/server-model-runtime.js";
import {
  invalidateCatalogue,
  _resetForTests as resetCatalogueCache,
  setCatalogueForSession,
} from "../package/provider-catalogue-cache.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

const agentDir = path.join(os.homedir(), ".pi", "agent");
const authPath = path.join(agentDir, "auth.json");
const providersPath = path.join(agentDir, "providers.json");

type Check = { source?: string; type: "api_key" | "oauth" } | undefined;

interface FakeProvider {
  id: string;
  name?: string;
  oauth?: boolean;
}

/** Fake runtime; `checks` maps provider id → checkAuth result. */
function fakeRuntime(providers: FakeProvider[], checks: Record<string, Check> = {}) {
  const checkAuth = vi.fn(async (id: string): Promise<Check> => checks[id]);
  return {
    checkAuth,
    runtime: {
      getProviders: () =>
        providers.map((p) => ({ id: p.id, name: p.name, auth: p.oauth ? { oauth: { name: p.id } } : {} })),
      checkAuth,
    },
  };
}

async function loadFake(providers: FakeProvider[], checks: Record<string, Check> = {}) {
  const fake = fakeRuntime(providers, checks);
  setOAuthRegistryRuntimeSource(async () => ({ runtime: fake.runtime }) as never);
  await oauthRegistryReady();
  return fake;
}

const apiKeyRows = <T extends { flowType: string }>(rows: T[]): T[] => rows.filter((r) => r.flowType === "api_key");

beforeEach(() => {
  fs.mkdirSync(agentDir, { recursive: true });
  fs.rmSync(authPath, { force: true });
  fs.rmSync(providersPath, { force: true });
  resetCatalogueCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(authPath, { force: true });
  fs.rmSync(providersPath, { force: true });
  resetCatalogueCache();
  setOAuthRegistryRuntimeSource(undefined);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function buildApp(sessionIds: string[] = []) {
  const sendToSession = vi.fn();
  const app = Fastify({ logger: false });
  registerProviderAuthRoutes(app, {
    piGateway: { broadcast: vi.fn(), sendToSession, getConnectedSessionIds: () => sessionIds } as never,
    browserGateway: { broadcastToAll: vi.fn() } as never,
  });
  await app.ready();
  return { app, sendToSession };
}

describe("first-run provider catalogue (runtime fallback)", () => {
  it("E1: no catalogue, no auth.json → fallback api-key rows + OAuth rows; nudges the bridge", async () => {
    await loadFake([{ id: "deepseek", name: "DeepSeek" }, { id: "anthropic", name: "Anthropic", oauth: true }]);
    const { app, sendToSession } = await buildApp(["s1"]);
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; flowType: string; authenticated: boolean; name: string }>;
    const deepseek = rows.find((r) => r.id === "deepseek");
    expect(deepseek).toMatchObject({ flowType: "api_key", authenticated: false, name: "DeepSeek" });
    expect(rows.find((r) => r.id === "anthropic-api")).toMatchObject({ flowType: "api_key" });
    expect(rows.find((r) => r.id === "anthropic" && r.flowType !== "api_key")).toBeDefined();
    expect(sendToSession).toHaveBeenCalledWith("s1", { type: "request_providers", sessionId: "s1" });
    await app.close();
  });

  it("E2: real runtime, cold HOME → deepseek and openrouter-api rows, all unauthenticated", async () => {
    // A key in the developer/CI env would legitimately authenticate a row.
    for (const k of Object.keys(process.env)) if (/_(API_KEY|TOKEN)$/.test(k)) vi.stubEnv(k, "");
    setOAuthRegistryRuntimeSource(getServerModelRuntime);
    await oauthRegistryReady();
    const rows = apiKeyRows(await getAuthStatus());
    expect(rows.find((r) => r.id === "deepseek")).toBeDefined();
    expect(rows.find((r) => r.id === "openrouter-api")).toBeDefined();
    // Ambient providers (AWS keys, gcloud ADC) may legitimately authenticate on the host.
    expect(
      rows.filter((r) => r.id === "deepseek" || r.id === "openrouter-api").every((r) => r.authenticated === false),
    ).toBe(true);
  });

  it("E5: env-var row is configured-not-authenticated; ambient-label row is authenticated", async () => {
    vi.stubEnv("OPENAI_COMPAT_API_KEY", "x");
    await loadFake(
      [{ id: "envy" }, { id: "ambient" }],
      {
        envy: { type: "api_key", source: "OPENAI_COMPAT_API_KEY" },
        ambient: { type: "api_key", source: "AWS access keys" },
      },
    );
    const rows = apiKeyRows(await getAuthStatus());
    expect(rows.find((r) => r.id === "envy")).toMatchObject({
      configured: true,
      authenticated: false,
      envVar: "OPENAI_COMPAT_API_KEY",
    });
    const ambient = rows.find((r) => r.id === "ambient")!;
    expect(ambient.authenticated).toBe(true);
    expect(ambient.authLabel).toBe("AWS access keys");
  });

  it("E6: custom providers get no api-key row", async () => {
    fs.writeFileSync(providersPath, JSON.stringify({ providers: { "my-llm": {}, deepseek: {} } }));
    await loadFake([{ id: "my-llm" }, { id: "deepseek" }, { id: "groq" }]);
    const ids = apiKeyRows(await getAuthStatus()).map((r) => r.id);
    expect(ids).not.toContain("my-llm");
    expect(ids).not.toContain("deepseek");
    expect(ids).toContain("groq");
  });

  it("E7: corrupt providers.json fails open — no id is marked custom", async () => {
    fs.writeFileSync(providersPath, "{");
    await loadFake([{ id: "my-llm" }]);
    const { app } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(res.statusCode).toBe(200);
    expect(apiKeyRows<{ id: string; flowType: string }>(res.json()).map((r) => r.id)).toContain("my-llm");
    await app.close();
  });

  it("E8: a bridge push takes precedence; invalidation hands back to the fallback", async () => {
    await loadFake([{ id: "deepseek" }]);
    expect(apiKeyRows(await getAuthStatus()).map((r) => r.id)).toContain("deepseek");

    setCatalogueForSession("s1", [{ id: "custom-llm", displayName: "Custom", hasOAuth: false, configured: false }]);
    const during = apiKeyRows(await getAuthStatus()).map((r) => r.id);
    expect(during).toContain("custom-llm");
    expect(during).not.toContain("deepseek");

    invalidateCatalogue();
    const after = apiKeyRows(await getAuthStatus()).map((r) => r.id);
    expect(after).toContain("deepseek");
    expect(after).not.toContain("custom-llm");
  });

  it("E10: a key saved against a fallback row is reported as stored", async () => {
    await loadFake([{ id: "deepseek" }]);
    const { app } = await buildApp();
    const put = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      payload: { provider: "deepseek", key: "sk-test-1234567890" },
    });
    expect(put.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    const row = res.json().find((r: { id: string }) => r.id === "deepseek");
    expect(row).toMatchObject({
      authenticated: true,
      configured: true,
      source: "stored",
      maskedKey: "sk-te...890",
    });
    await app.close();
  });

  it("E9(a): an empty push does not mask the fallback and the nudge keeps firing", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    await loadFake([{ id: "deepseek" }]);
    setCatalogueForSession("s1", []);
    const { app, sendToSession } = await buildApp(["s1"]);
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(apiKeyRows<{ id: string; flowType: string }>(res.json()).map((r) => r.id)).toContain("deepseek");
    expect(sendToSession).toHaveBeenCalledWith("s1", { type: "request_providers", sessionId: "s1" });
    await app.close();
  });

  it("E13: a retained runtime without checkAuth yields no api-key rows", async () => {
    setOAuthRegistryRuntimeSource(async () => ({ runtime: { getProviders: () => [{ id: "deepseek" }] } }) as never);
    await oauthRegistryReady();
    expect(apiKeyRows(await getAuthStatus())).toEqual([]);
  });

  it("X1: getProviders throws → 200, OAuth rows, zero api-key rows", async () => {
    await loadFake([{ id: "anthropic", oauth: true }]);
    // First call (registry init) succeeded; now the runtime misbehaves.
    _setRegistryRuntimeForTests({
      getProviders: () => {
        throw new Error("boom");
      },
      checkAuth: async () => undefined,
    });
    const { app } = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ flowType: string }>;
    expect(apiKeyRows(rows)).toHaveLength(0);
    expect(rows.some((r) => r.flowType !== "api_key")).toBe(true);
    await app.close();
  });

  it("X3: unparseable auth.json → no api-key rows, checkAuth never called", async () => {
    fs.writeFileSync(authPath, "{");
    const fake = await loadFake([{ id: "deepseek" }]);
    expect(apiKeyRows(await getAuthStatus())).toEqual([]);
    expect(fake.checkAuth).not.toHaveBeenCalled();
  });

  it("X4: expired OAuth credential is neither refreshed nor rewritten", async () => {
    const stored = JSON.stringify({
      anthropic: { type: "oauth", access: "a", refresh: "r", expires: Date.now() - 60_000 },
    });
    fs.writeFileSync(authPath, stored);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setOAuthRegistryRuntimeSource(getServerModelRuntime);
    await oauthRegistryReady();
    await getAuthStatus();
    expect(fs.readFileSync(authPath, "utf8")).toBe(stored);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
