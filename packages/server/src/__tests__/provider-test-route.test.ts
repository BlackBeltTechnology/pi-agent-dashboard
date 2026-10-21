import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerProviderRoutes } from "../routes/provider-routes.js";

// Pass-through network guard — we're testing the endpoint contract, not auth
const allowGuard = async () => {};

function makeApp() {
  const app = Fastify();
  registerProviderRoutes(app, { networkGuard: allowGuard as any });
  return app;
}

describe("POST /api/providers/test", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

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
});
