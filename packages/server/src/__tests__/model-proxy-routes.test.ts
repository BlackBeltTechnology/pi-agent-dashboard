/**
 * Integration tests for model proxy route handlers (task 8.4).
 *
 * Uses Fastify inject + in-memory mock registry — no real pi-ai.
 *
 * Covers:
 * - GET /v1/models returns correct shape
 * - POST /v1/chat/completions streaming round-trip
 * - POST /v1/chat/completions non-streaming round-trip
 * - POST /v1/messages streaming round-trip
 * - auth missing → 401 (auth gate wired)
 * - concurrency cap exhaust → 503
 */
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerModelProxyRoutes } from "../routes/model-proxy-routes.js";
import { createModelProxyAuthGate } from "../model-proxy/auth-gate.js";
import { generateKey, hashKey } from "../model-proxy/api-key-store.js";
import type { ModelProxyConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";

// ── Fake stream ────────────────────────────────────────────────────────────

async function* fakeTextStream(text: string): AsyncIterable<any> {
  yield { type: "start" };
  yield { type: "text_delta", delta: text };
  yield {
    type: "done",
    message: {
      content: [{ type: "text", text }],
      stopReason: "stop",
      usage: { input: 5, output: 3 },
    },
  };
}

// ── Fake registry ──────────────────────────────────────────────────────────

function makeFakeRegistry(models?: any[]) {
  const list = models ?? [
    {
      id: "claude-3-5-sonnet",
      provider: "anthropic",
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: false,
    },
  ];
  return {
    getAvailable: async () => list,
    find: async (provider: string, modelId: string) =>
      list.find((m) => m.provider === provider && m.id === modelId) ?? null,
    firstAvailable: async (preferred: string[]) => {
      for (const label of preferred) {
        const slash = label.indexOf("/");
        if (slash <= 0) continue;
        const provider = label.slice(0, slash);
        const id = label.slice(slash + 1);
        const m = list.find((x) => x.provider === provider && x.id === id);
        if (m) return m;
      }
      return null;
    },
    getApiKeyAndHeaders: async () => ({ apiKey: "sk-test", headers: {} }),
  };
}

// ── Test setup ─────────────────────────────────────────────────────────────

function makeKey(scopes = ["all"]) {
  const cleartext = generateKey();
  const entry = {
    id: "k1",
    label: "test",
    createdAt: Date.now(),
    hash: hashKey(cleartext),
    scopes,
  };
  return { cleartext, entry };
}

async function buildApp(opts: {
  streamFn?: (o: any) => AsyncIterable<any>;
  capExhausted?: boolean;
  models?: any[];
  configOverrides?: Partial<ModelProxyConfig>;
} = {}) {
  const { cleartext, entry } = makeKey();
  const config: ModelProxyConfig = {
    enabled: true,
    maxConcurrentStreams: opts.capExhausted ? 0 : 16,
    perKeyConcurrentStreams: opts.capExhausted ? 0 : 4,
    logRequests: false,
    apiKeys: [entry],
    ...opts.configOverrides,
  };

  const streamFn = opts.streamFn ?? ((o: any) => fakeTextStream("hello"));

  const app = Fastify({ logger: false });

  const gate = createModelProxyAuthGate({ getConfig: () => config });
  app.addHook("onRequest", gate);

  registerModelProxyRoutes(app, {
    getConfig: () => config,
    getRegistry: async () => makeFakeRegistry(opts.models),
    streamSimple: streamFn,
  });

  await app.ready();
  return { app, cleartext, config };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /v1/models (task 8.4)", () => {
  it("returns list shape with model data", async () => {
    const { app, cleartext } = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${cleartext}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    const m = body.data[0];
    expect(m.id).toContain("claude-3-5-sonnet");
    expect(m.object).toBe("model");
    expect(m["x-pi"].contextWindow).toBe(200000);
  });

  it("auth missing → 401", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/chat/completions (task 8.4)", () => {
  it("non-streaming returns OpenAI completion shape", async () => {
    const { app, cleartext } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${cleartext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("hello");
    expect(body.choices[0].finish_reason).toBe("stop");
  });

  it("streaming returns text/event-stream with [DONE]", async () => {
    const { app, cleartext } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${cleartext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("[DONE]");
    expect(res.body).toContain("hello");
  });

  it("model not found → 404", async () => {
    const { app, cleartext } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${cleartext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/nonexistent",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });

    expect(res.statusCode).toBe(404);
  });

  it("concurrency cap exhaust → 503 SERVER_FULL", async () => {
    const { app, cleartext } = await buildApp({ capExhausted: true });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: {
        authorization: `Bearer ${cleartext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });

    expect([429, 503]).toContain(res.statusCode);
  });
});

describe("POST /v1/messages (task 8.4)", () => {
  it("returns Anthropic response shape", async () => {
    const { app, cleartext } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: `Bearer ${cleartext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
        stream: false,
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.content[0].text).toBe("hello");
    expect(body.stop_reason).toBe("end_turn");
  });

  it("Anthropic streaming returns SSE", async () => {
    const { app, cleartext } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: `Bearer ${cleartext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
        stream: true,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("message_start");
  });

  it("missing max_tokens → 400", async () => {
    const { app, cleartext } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: {
        authorization: `Bearer ${cleartext}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-3-5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        // no max_tokens
      }),
    });

    expect(res.statusCode).toBe(400);
  });
});

// ── Model-id resolution (change: fix-and-prefer-model-proxy-resolution) ──────

const MULTI_SLASH_MODEL = {
  id: "anthropic/claude-3.5-sonnet",
  provider: "openrouter",
  contextWindow: 200000,
  maxTokens: 8192,
};

describe("model-id resolution — first-slash parse", () => {
  it("multi-slash id resolves (not 404) on /v1/chat/completions", async () => {
    const { app, cleartext } = await buildApp({ models: [MULTI_SLASH_MODEL] });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/anthropic/claude-3.5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).choices[0].message.content).toBe("hello");
  });

  it("round-trip: every /v1/models id resolves on /v1/chat/completions", async () => {
    const models = [
      MULTI_SLASH_MODEL,
      { id: "claude-3-5-sonnet", provider: "anthropic" },
      { id: "gpt-4o", provider: "openai" },
    ];
    const { app, cleartext } = await buildApp({ models });

    const list = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${cleartext}` },
    });
    const ids: string[] = JSON.parse(list.body).data.map((m: any) => m.id);
    expect(ids).toContain("openrouter/anthropic/claude-3.5-sonnet");

    for (const id of ids) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
        body: JSON.stringify({ model: id, messages: [{ role: "user", content: "hi" }], stream: false }),
      });
      expect(res.statusCode, `id ${id} should resolve`).not.toBe(404);
    }
  });

  it("multi-slash id resolves on /v1/messages", async () => {
    const { app, cleartext } = await buildApp({ models: [MULTI_SLASH_MODEL] });

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "openrouter/anthropic/claude-3.5-sonnet",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
        stream: false,
      }),
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("model-id resolution — aliases + preferred fallback", () => {
  it("alias expands to a fully-qualified id", async () => {
    const { app, cleartext } = await buildApp({
      models: [{ id: "claude-3-5-sonnet", provider: "anthropic" }],
      configOverrides: { modelAliases: { claude: "anthropic/claude-3-5-sonnet" } },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "claude", messages: [{ role: "user", content: "hi" }], stream: false }),
    });

    expect(res.statusCode).toBe(200);
  });

  it("omitted model uses first available preferred entry", async () => {
    const { app, cleartext } = await buildApp({
      // anthropic/... NOT in registry (unavailable); openai/gpt-4o IS.
      models: [{ id: "gpt-4o", provider: "openai" }],
      configOverrides: { preferredModels: ["anthropic/claude-3-5-sonnet", "openai/gpt-4o"] },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], stream: false }),
    });

    expect(res.statusCode).toBe(200);
  });

  it("preferredModels supersedes defaultModel on omitted model", async () => {
    // defaultModel points at an UNavailable model; preferred points at the
    // available one. Resolution must pick preferred (200), not defaultModel (404).
    const { app, cleartext } = await buildApp({
      models: [{ id: "gpt-4o", provider: "openai" }],
      configOverrides: {
        defaultModel: "anthropic/ghost",
        preferredModels: ["openai/gpt-4o"],
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], stream: false }),
    });

    expect(res.statusCode).toBe(200);
  });

  it("unresolved model with no available preferred → 404", async () => {
    const { app, cleartext } = await buildApp({
      models: [{ id: "gpt-4o", provider: "openai" }],
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "ghost/none", messages: [{ role: "user", content: "hi" }], stream: false }),
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.message).toBe("Model not found: ghost/none");
  });
});
