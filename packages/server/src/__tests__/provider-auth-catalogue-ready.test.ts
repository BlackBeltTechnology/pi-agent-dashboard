/**
 * GET /api/provider-auth/catalogue-ready — the catalogue availability signal
 * (D5, test-plan E18). `ready` answers "does a pushed provider catalogue
 * exist", which is what lets the client distinguish "no api-key credentials"
 * from "the api-key provider list is unavailable". The signal is a separate
 * route on purpose: it must NOT ride on `GET /api/provider-auth/status` (bare
 * array, pinned by provider-auth-ui) nor on a response header.
 *
 * Route-level states here; the disconnect-driven transition lives in
 * `catalogue-invalidation.test.ts`. See change:
 * redesign-providers-settings-page (D5).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setOAuthRegistryRuntimeSource } from "../auth/provider-auth-registry.js";
import { ModelRuntimeUnavailableError } from "../model-proxy/server-model-runtime.js";
import {
  _resetForTests,
  setCatalogueForSession,
} from "../package/provider-catalogue-cache.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

beforeEach(() => {
  _resetForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  _resetForTests();
  setOAuthRegistryRuntimeSource(undefined);
  vi.restoreAllMocks();
});

/** A fake runtime handle exposing the given providers; `checkAuth` → undefined. */
function fakeHandle(ids: Array<{ id: string; name?: string; oauth?: boolean }>) {
  return {
    runtime: {
      getProviders: () =>
        ids.map((p) => ({ id: p.id, name: p.name, auth: p.oauth ? { oauth: { name: p.id } } : {} })),
      checkAuth: async () => undefined,
    },
  };
}

const providersJsonPath = () => path.join(os.homedir(), ".pi", "agent", "providers.json");

async function buildApp() {
  const app = Fastify({ logger: false });
  registerProviderAuthRoutes(app, {
    piGateway: { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any,
    browserGateway: { broadcastToAll: vi.fn() } as any,
  });
  await app.ready();
  return app;
}

describe("GET /api/provider-auth/catalogue-ready (E18)", () => {
  it("state 1: no catalogue pushed since server start → { ready: false }", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: false, fallback: false });
    await app.close();
  });

  it("state 2: a session has pushed a catalogue → { ready: true }", async () => {
    setCatalogueForSession("s1", [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
    ]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true, fallback: false });
    await app.close();
  });
});

// Test-plan #E11 / #X5 / #X6 / #E13. See change: fix-provider-catalogue-first-run (D4).
describe("GET /api/provider-auth/catalogue-ready — runtime fallback", () => {
  afterEach(() => fs.rmSync(providersJsonPath(), { force: true }));

  it("E11(b): none held + a non-custom runtime provider → { ready:false, fallback:true }", async () => {
    setOAuthRegistryRuntimeSource(async () => fakeHandle([{ id: "anthropic", oauth: true }, { id: "deepseek" }]) as any);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(res.json()).toEqual({ ready: false, fallback: true });
    await app.close();
  });

  it("E11(c): runtime exposing only custom ids → { ready:false, fallback:false }", async () => {
    fs.mkdirSync(path.dirname(providersJsonPath()), { recursive: true });
    fs.writeFileSync(providersJsonPath(), JSON.stringify({ providers: { "my-llm": {} } }));
    setOAuthRegistryRuntimeSource(async () => fakeHandle([{ id: "my-llm", oauth: true }]) as any);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(res.json()).toEqual({ ready: false, fallback: false });
    await app.close();
  });

  it("E11(d)/X6: runtime create rejects → { ready:false, fallback:false }, /status still 200 with no api-key rows", async () => {
    setOAuthRegistryRuntimeSource(async () => {
      throw new ModelRuntimeUnavailableError("boom", "1.3.0");
    });
    const app = await buildApp();
    const ready = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(ready.json()).toEqual({ ready: false, fallback: false });
    const status = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().filter((r: { flowType: string }) => r.flowType === "api_key")).toHaveLength(0);
    await app.close();
  });

  it("E13: a retained runtime without checkAuth → api-key portion [] and fallback:false", async () => {
    setOAuthRegistryRuntimeSource(
      async () => ({ runtime: { getProviders: () => [{ id: "deepseek" }] } }) as any,
    );
    const app = await buildApp();
    const ready = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(ready.json()).toEqual({ ready: false, fallback: false });
    const status = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(status.json().filter((r: { flowType: string }) => r.flowType === "api_key")).toEqual([]);
    await app.close();
  });

  it("X5: the request waits for runtime start-up, then answers fallback:true", async () => {
    let release!: (h: unknown) => void;
    const deferred = new Promise<unknown>((r) => (release = r));
    setOAuthRegistryRuntimeSource(() => deferred as any);
    const app = await buildApp();
    let answered = false;
    const pending = app
      .inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" })
      .then((r) => {
        answered = true;
        return r;
      });
    await new Promise((r) => setTimeout(r, 50));
    expect(answered).toBe(false);
    release(fakeHandle([{ id: "anthropic", oauth: true }, { id: "deepseek" }]));
    const res = await pending;
    expect(res.json()).toEqual({ ready: false, fallback: true });
    await app.close();
  });
});
