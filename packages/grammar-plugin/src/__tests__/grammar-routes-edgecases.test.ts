/**
 * Edge-case coverage for the grammar REST routes: config/body plumbing into the
 * service, model-registry resolution ONLY for the llm backend (and tolerating a
 * throwing resolver), thrown-check safety, full error-code→HTTP mapping (incl.
 * the unknown-code fallback), and health for the llm backend. Complements
 * `grammar-routes.test.ts`. See: grammar LLM "no issues despite a clear error" bugfix + edge-case hardening.
 */

import type { GrammarCheckResult } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { GrammarConfig } from "../grammar-config.js";
import { DEFAULT_GRAMMAR } from "../grammar-config.js";
import type { GrammarRouteDeps } from "../server/routes.js";
import { mountGrammarRoutes } from "../server/routes.js";

const okResult: GrammarCheckResult = {
  backend: "llm",
  correctedText: "I have an apple",
  suggestions: [],
  summary: "No issues found",
  language: "en-US",
  truncated: false,
};

function makeApp(over: Partial<GrammarRouteDeps> = {}, config?: Partial<GrammarConfig>) {
  const app = Fastify();
  mountGrammarRoutes(app, {
    getGrammarConfig: () => ({
      ...DEFAULT_GRAMMAR,
      enabled: true,
      ...config,
    }),
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

describe("POST /api/grammar/check — plumbing", () => {
  it("forwards text and language from the body into the service", async () => {
    const seen: { text?: string; language?: string } = {};
    const app = makeApp({
      check: async (args) => {
        seen.text = args.text;
        seen.language = args.language;
        return { ok: true, result: okResult };
      },
    });
    await app.ready();
    await app.inject({
      method: "POST",
      url: "/api/grammar/check",
      payload: { text: "I has a apple", language: "en-US" },
    });
    expect(seen).toEqual({ text: "I has a apple", language: "en-US" });
    await app.close();
  });

  it("coerces a non-string body.text to empty string", async () => {
    let seenText: unknown = "unset";
    const app = makeApp({
      check: async (args) => {
        seenText = args.text;
        return { ok: false, code: "empty_text", message: "empty" };
      },
    });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: 123 } });
    expect(seenText).toBe("");
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("resolves the model registry for every check (llm is the only backend)", async () => {
    const getModelRegistry = vi.fn(async () => null);
    const app = makeApp({ getModelRegistry });
    await app.ready();
    await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
    expect(getModelRegistry).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("passes the resolved registry + streamSimple into the service for llm", async () => {
    const registry = { find: async () => ({}), getApiKeyAndHeaders: async () => ({ apiKey: "k", headers: {} }) };
    const streamSimple = vi.fn();
    const seen: { registry?: unknown; streamSimple?: unknown } = {};
    const app = makeApp(
      {
        getModelRegistry: async () => registry,
        streamSimple: streamSimple as never,
        check: async (args) => {
          seen.registry = args.registry;
          seen.streamSimple = args.streamSimple;
          return { ok: true, result: okResult };
        },
      },
    );
    await app.ready();
    await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
    expect(seen.registry).toBe(registry);
    expect(seen.streamSimple).toBe(streamSimple);
    await app.close();
  });

  it("tolerates a throwing model-registry resolver (passes null, still checks)", async () => {
    const seen: { registry?: unknown } = { registry: "unset" };
    const app = makeApp(
      {
        getModelRegistry: async () => {
          throw new Error("resolver down");
        },
        check: async (args) => {
          seen.registry = args.registry;
          return { ok: true, result: okResult };
        },
      },
    );
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
    expect(res.statusCode).toBe(200);
    expect(seen.registry).toBeNull();
    await app.close();
  });

  it("maps a thrown check to 502 backend_unreachable", async () => {
    const app = makeApp({
      check: async () => {
        throw new Error("service exploded");
      },
    });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
    expect(res.statusCode).toBe(502);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe("backend_unreachable");
    await app.close();
  });
});

describe("POST /api/grammar/check — error-code → HTTP mapping", () => {
  const cases: Array<[string, number]> = [
    ["grammar_disabled", 409],
    ["empty_text", 400],
    ["backend_unconfigured", 400],
    ["backend_unreachable", 502],
    ["backend_timeout", 504],
    ["backend_bad_response", 502],
  ];
  for (const [code, status] of cases) {
    it(`maps ${code} → ${status}`, async () => {
      const app = makeApp({ check: async () => ({ ok: false, code: code as never, message: code }) });
      await app.ready();
      const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
      expect(res.statusCode).toBe(status);
      const body = JSON.parse(res.payload);
      expect(body.success).toBe(false);
      expect(body.code).toBe(code);
      await app.close();
    });
  }

  it("falls back to 500 for an unknown error code", async () => {
    const app = makeApp({ check: async () => ({ ok: false, code: "totally_bogus" as never, message: "x" }) });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/grammar/check", payload: { text: "hi there" } });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

describe("GET /api/grammar/health", () => {
  it("returns the llm backend without a languagetool block", async () => {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/grammar/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.backend).toBe("llm");
    expect(body.data.languagetool).toBeUndefined();
    await app.close();
  });
});
