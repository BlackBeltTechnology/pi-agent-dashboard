/**
 * GET /api/models projects the RAW native `thinkingLevelMap`, derives NO
 * server-side `supportedThinkingLevels`, and NEVER emits `compat` or any
 * credential — default and ?annotated=1.
 *
 * See change: honor-native-models-json-metadata (test-plan S1, §5.3).
 */
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerModelsIntrospectionRoute } from "../routes/models-introspection-routes.js";

const MAP = { minimal: null, xhigh: "xhigh" };

// The registry model carries `compat` (for proxy routing); toRow must drop it.
const model = {
  id: "glm-5.2",
  provider: "newapi",
  reasoning: true,
  input: ["text", "image"],
  contextWindow: 200000,
  maxTokens: 65536,
  thinkingLevelMap: MAP,
  compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true },
  cost: { input: 3, output: 15 },
};

function makeRegistry() {
  return {
    getAvailable: async () => [model],
    getAllAnnotated: () => [{ model, excludedReason: null as null }],
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  registerModelsIntrospectionRoute(app, { getRegistry: async () => makeRegistry() });
  await app.ready();
  return app;
}

describe("GET /api/models — thinkingLevelMap passthrough, no compat, no derivation", () => {
  it("default variant emits raw thinkingLevelMap, no supportedThinkingLevels, no compat", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/models" });
    const row = JSON.parse(res.body).data[0];
    expect(row.thinkingLevelMap).toEqual(MAP);
    expect(row.supportedThinkingLevels).toBeUndefined();
    expect(row.compat).toBeUndefined();
  });

  it("?annotated=1 variant also omits compat + derived levels", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/models?annotated=1" });
    const row = JSON.parse(res.body).data[0];
    expect(row.thinkingLevelMap).toEqual(MAP);
    expect(row.supportedThinkingLevels).toBeUndefined();
    expect(row.compat).toBeUndefined();
  });

  it("neither variant leaks compat or credentials anywhere in the payload", async () => {
    const app = await buildApp();
    for (const url of ["/api/models", "/api/models?annotated=1"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.body).not.toMatch(/compat|thinkingFormat|deepseek|api_?key|bearer|secret|access_?token/i);
    }
  });
});
