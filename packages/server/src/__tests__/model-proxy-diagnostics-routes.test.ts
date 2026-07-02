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
const getModelRegistry = vi.fn(async () => ({ getAllAnnotated }));

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
  getModelRegistry.mockResolvedValue({ getAllAnnotated });
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
