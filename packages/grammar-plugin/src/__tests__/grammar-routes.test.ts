import type { GrammarCheckResult } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { DEFAULT_GRAMMAR } from "../grammar-config.js";
import { mountGrammarRoutes } from "../server/routes.js";

const okResult: GrammarCheckResult = {
  backend: "llm",
  correctedText: "I have an apple",
  suggestions: [
    { id: "2:3:0", offset: 2, length: 3, original: "has", replacement: "have", kind: "grammar", message: "Agreement" },
  ],
  summary: "1 grammar",
  language: "en-US",
  truncated: false,
};

function makeApp(over: Partial<Parameters<typeof mountGrammarRoutes>[1]> = {}) {
  const app = Fastify();
  mountGrammarRoutes(app, {
    getGrammarConfig: () => ({ ...DEFAULT_GRAMMAR, enabled: true }),
    check: async () => ({ ok: true, result: okResult }),
    health: () => ({
      enabled: true,
      backend: "llm",
      autoCheck: true,
      debounceMs: 1200,
      minChars: 12,
      language: "auto",
      correctionView: "redline",
    }),
    ...over,
  });
  return app;
}

describe("POST /api/grammar/check", () => {
  it("returns the result envelope on success", async () => {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "I has a apple" } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.correctedText).toBe("I have an apple");
    expect(body.data.suggestions).toHaveLength(1);
    await app.close();
  });

  it("maps grammar_disabled to 409", async () => {
    const app = makeApp({ check: async () => ({ ok: false, code: "grammar_disabled", message: "off" }) });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi" } });
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.code).toBe("grammar_disabled");
    await app.close();
  });

  it("maps empty_text to 400", async () => {
    const app = makeApp({ check: async () => ({ ok: false, code: "empty_text", message: "empty" }) });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("maps backend_unreachable to 502", async () => {
    const app = makeApp({ check: async () => ({ ok: false, code: "backend_unreachable", message: "down" }) });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it("maps backend_timeout to 504", async () => {
    const app = makeApp({ check: async () => ({ ok: false, code: "backend_timeout", message: "slow" }) });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
    expect(res.statusCode).toBe(504);
    await app.close();
  });
});

describe("GET /api/grammar/health", () => {
  it("returns the llm backend config and no languagetool block", async () => {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/grammar/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.backend).toBe("llm");
    expect(body.data.languagetool).toBeUndefined();
    await app.close();
  });
});

import { resolveModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
// ── role-aware llm (add-role-aware-model-refs) ───────────────────────────
import { checkGrammar } from "../server/grammar-service.js";

describe("role-aware grammar model", () => {
  const streamSimple = (() => {
    throw new Error("not reached");
  }) as never;
  function roleApp(roles: Record<string, string>, find: (p: string, id: string) => Promise<unknown>) {
    const app = Fastify();
    mountGrammarRoutes(app, {
      getGrammarConfig: () => ({ ...DEFAULT_GRAMMAR, enabled: true, llm: { role: "@fast" } }),
      getModelRegistry: async () => ({ find }) as never,
      streamSimple,
      check: (args) =>
        checkGrammar({ ...args, resolveRole: (ref) => resolveModelRef(ref, { roles }) }),
    });
    return app;
  }

  it("E21: a preset change applies on the NEXT check (registry find sees A then B)", async () => {
    const roles: Record<string, string> = { fast: "anthropic/model-a" };
    const calls: string[] = [];
    const app = roleApp(roles, async (p, id) => {
      calls.push(`${p}/${id}`);
      return undefined; // → backend_unconfigured after the lookup; we only assert the lookup
    });
    await app.ready();
    await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hello there" } });
    roles.fast = "openai/model-b";
    await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hello there" } });
    expect(calls).toEqual(["anthropic/model-a", "openai/model-b"]);
    await app.close();
  });

  it("X13: unassigned role → model_role_unassigned naming the role; registry never called", async () => {
    let called = false;
    const app = roleApp({}, async () => {
      called = true;
      return undefined;
    });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hello there" } });
    const body = JSON.parse(res.payload);
    expect(body.code).toBe("model_role_unassigned");
    expect(body.error).toContain("@fast");
    expect(res.statusCode).toBe(409);
    expect(called).toBe(false);
    await app.close();
  });

  it("E22: a direct llm calls the registry exactly as before", async () => {
    const calls: string[] = [];
    const app = Fastify();
    mountGrammarRoutes(app, {
      getGrammarConfig: () => ({ ...DEFAULT_GRAMMAR, enabled: true, llm: { provider: "anthropic", model: "claude-haiku-4-5" } }),
      getModelRegistry: async () =>
        ({ find: async (p: string, id: string) => (calls.push(`${p}/${id}`), undefined) }) as never,
      streamSimple,
    });
    await app.ready();
    await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hello there" } });
    expect(calls).toEqual(["anthropic/claude-haiku-4-5"]);
    await app.close();
  });
});
