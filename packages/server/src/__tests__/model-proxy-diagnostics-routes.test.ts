/**
 * Route-level tests for GET /api/model-proxy/diagnostics.
 *
 * Mocks the registry singleton — no real pi-ai.
 *
 * See change: filter-oauth-incompatible-models, task 4.3.
 */

import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAllAnnotated = vi.fn();
const getMissingOAuthProviders = vi.fn(() => [] as string[]);
const getModelRegistry = vi.fn(async (): Promise<unknown> => ({ getAllAnnotated, getMissingOAuthProviders }));

vi.mock("../model-proxy/registry-singleton.js", () => ({
  getModelRegistry: () => getModelRegistry(),
}));

import { registerModelProxyDiagnosticsRoutes } from "../routes/model-proxy-diagnostics-routes.js";

async function buildApp() {
  const app = Fastify({ logger: false });
  registerModelProxyDiagnosticsRoutes(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  getAllAnnotated.mockReset();
  getModelRegistry.mockClear();
  getModelRegistry.mockResolvedValue({ getAllAnnotated, getMissingOAuthProviders });
});

describe("GET /api/model-proxy/diagnostics", () => {
  it("returns { id, provider, excludedReason } per model", async () => {
    getAllAnnotated.mockReturnValue([
      { model: { provider: "anthropic", id: "claude-3-5-haiku-20241022" }, excludedReason: "oauth-incompatible" },
      { model: { provider: "anthropic", id: "claude-haiku-4-5" }, excludedReason: null },
      { model: { provider: "openai", id: "gpt-4o" }, excludedReason: "no-credential" },
    ]);

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/model-proxy/diagnostics" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      { id: "anthropic/claude-3-5-haiku-20241022", provider: "anthropic", excludedReason: "oauth-incompatible" },
      { id: "anthropic/claude-haiku-4-5", provider: "anthropic", excludedReason: null },
      { id: "openai/gpt-4o", provider: "openai", excludedReason: "no-credential" },
    ]);
  });

  it("returns 503 when the registry cannot be resolved", async () => {
    getModelRegistry.mockRejectedValue(new Error("pi-ai unavailable"));

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/model-proxy/diagnostics" });

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("MODEL_PROXY_RUNTIME_MISSING");
  });
});

/**
 * test-plan #E6 — a stored OAuth credential whose runtime provider exposes no
 * OAuth implementation: the completion fails with a NAMED missing-OAuth error
 * (no TypeError), diagnostics lists the provider, api-key providers route.
 * Real `InternalRegistry` + auth facade over a real pi-ai `Models` collection.
 * See change: collapse-model-proxy-onto-modelruntime (D5).
 */
describe("missing OAuth capability (E6)", () => {
  it("E6: named error on completion, diagnostics missingOAuth, api-key provider still routable", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = path.join(os.homedir(), ".pi", "agent");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "auth.json"),
      JSON.stringify({
        noauth: { type: "oauth", access: "a", refresh: "r", expires: Date.now() + 3_600_000 },
        openai: { type: "api_key", key: "sk-openai" },
      }),
      { mode: 0o600 },
    );
    const { piModelsOver } = await import("./helpers/pi-models-fixture.js");
    const { InternalAuthStorage } = await import("../model-proxy/internal-auth-storage.js");
    const { InternalRegistry } = await import("../model-proxy/internal-registry.js");
    const { readAuthJson } = await import("../auth/provider-auth-storage.js");
    const { registerModelProxyRoutes } = await import("../routes/model-proxy-routes.js");

    const { models } = piModelsOver({ apiKey: ["openai"], bare: ["noauth"] });
    const catalogue = {
      getProviders: () => [{ id: "noauth" }, { id: "openai" }],
      getModels: (p?: string) =>
        p === "noauth" ? [{ id: "m1", provider: "noauth", api: "openai-completions" }] : [{ id: "gpt", provider: "openai", api: "openai-completions" }],
    };
    const registry = new InternalRegistry(catalogue, new InternalAuthStorage(models as never), {
      readProviders: () => ({}),
      readModels: () => [],
      readAuth: () => readAuthJson(),
    });
    getModelRegistry.mockResolvedValue(registry);

    const app = Fastify({ logger: false });
    registerModelProxyDiagnosticsRoutes(app);
    registerModelProxyRoutes(app, {
      getConfig: () => ({ enabled: true, maxConcurrentStreams: 4, perKeyConcurrentStreams: 4, logRequests: false, apiKeys: [] }),
      getRegistry: async () => registry,
      streamSimple: async function* () {
        yield { type: "done", message: { content: [{ type: "text", text: "ok" }], stopReason: "stop", usage: { input: 1, output: 1 } } };
      },
    });
    await app.ready();

    const post = (model: string) =>
      app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], stream: false }),
      });

    const failed = await post("noauth/m1");
    expect(failed.statusCode).toBe(500);
    const message = JSON.parse(failed.body).error.message as string;
    expect(message).toMatch(/missing OAuth capability/);
    expect(message).not.toMatch(/TypeError|is not a function/);

    expect((await post("openai/gpt")).statusCode).toBe(200);

    const diag = JSON.parse((await app.inject({ method: "GET", url: "/api/model-proxy/diagnostics" })).body);
    expect(diag.missingOAuth).toEqual(["noauth"]);
    await app.close();
  });
});
