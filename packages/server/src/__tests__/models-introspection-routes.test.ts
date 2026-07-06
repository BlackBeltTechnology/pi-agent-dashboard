/**
 * Unit tests for the ungated model-introspection route (GET /api/models).
 *
 * Uses Fastify inject + in-memory fake registry — no real pi-ai.
 *
 * Covers:
 * - default = reachability-filtered rows (getAvailable) with native shape
 * - ?annotated=1 = every model + excludedReason (getAllAnnotated)
 * - no-secret invariant: no credential material in either payload
 * - registry unavailable → 503
 *
 * See change: surface-model-introspection-to-agents.
 */

import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerModelsIntrospectionRoute } from "../routes/models-introspection-routes.js";

// ── Fake registry ──────────────────────────────────────────────────────────

const reachable = {
  id: "claude-3-5-sonnet",
  provider: "anthropic",
  contextWindow: 200000,
  maxTokens: 8192,
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 3, output: 15 },
};
const unreachable = {
  id: "gpt-4o",
  provider: "openai",
  contextWindow: 128000,
  maxTokens: 4096,
  reasoning: false,
};

function makeFakeRegistry() {
  return {
    getAvailable: async () => [reachable],
    getAllAnnotated: () => [
      { model: reachable, excludedReason: null },
      { model: unreachable, excludedReason: "no-credential" as const },
    ],
  };
}

async function buildApp(registry: ReturnType<typeof makeFakeRegistry> | null = makeFakeRegistry()) {
  const app = Fastify({ logger: false });
  registerModelsIntrospectionRoute(app, { getRegistry: async () => registry });
  await app.ready();
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/models", () => {
  it("default returns reachability-filtered native rows", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/models" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row.id).toBe("anthropic/claude-3-5-sonnet");
    expect(row.provider).toBe("anthropic");
    expect(row.contextWindow).toBe(200000);
    expect(row.maxTokens).toBe(8192);
    expect(row.input).toEqual(["text", "image"]);
    expect(row.cost).toEqual({ input: 3, output: 15 });
    // default (non-annotated) rows carry no excludedReason
    expect(row.excludedReason).toBeUndefined();
  });

  it("?annotated=1 returns every model with excludedReason", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/models?annotated=1" });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data).toHaveLength(2);
    const ids = body.data.map((r: any) => r.id);
    expect(ids).toContain("openai/gpt-4o");
    const excluded = body.data.find((r: any) => r.id === "openai/gpt-4o");
    expect(excluded.excludedReason).toBe("no-credential");
    const included = body.data.find((r: any) => r.id === "anthropic/claude-3-5-sonnet");
    expect(included.excludedReason).toBeNull();
  });

  it("no credential material in either payload", async () => {
    const app = await buildApp();
    for (const url of ["/api/models", "/api/models?annotated=1"]) {
      const res = await app.inject({ method: "GET", url });
      // Credential-material field names/values only (maxTokens is a legit capability field).
      expect(res.body).not.toMatch(/api_?key|bearer|secret|oauth|access_?token|refresh_?token|"key":/i);
    }
  });

  it("registry unavailable → 503", async () => {
    const app = await buildApp(null);
    const res = await app.inject({ method: "GET", url: "/api/models" });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("MODEL_PROXY_RUNTIME_MISSING");
  });
});
