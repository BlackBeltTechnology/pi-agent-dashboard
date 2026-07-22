import { DEFAULT_GRAMMAR } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { GrammarCheckResult } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { mountGrammarRoutes } from "../server/routes.js";

const okResult: GrammarCheckResult = {
  backend: "languagetool",
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
    getGrammarConfig: () => ({ ...DEFAULT_GRAMMAR, languagetool: { ...DEFAULT_GRAMMAR.languagetool }, enabled: true }),
    check: async () => ({ ok: true, result: okResult }),
    health: async () => ({
      enabled: true,
      backend: "languagetool",
      autoCheck: true,
      debounceMs: 1200,
      minChars: 12,
      language: "auto",
      languagetool: { url: "http://localhost:8081", reachable: true },
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
  it("returns the active backend and LT reachability", async () => {
    const app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/grammar/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.backend).toBe("languagetool");
    expect(body.data.languagetool.reachable).toBe(true);
    await app.close();
  });
});
