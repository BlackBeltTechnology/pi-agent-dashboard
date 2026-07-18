import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildProbeRequest,
  resolveProbeApiKey,
  probeProvider,
  type ProbeInput,
} from "../package/provider-probe.js";

describe("buildProbeRequest", () => {
  it("openai-completions: GET {baseUrl}/models with Authorization: Bearer", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-abc",
      api: "openai-completions",
    });
    expect(req.url).toBe("https://api.example.com/v1/models");
    expect(req.headers.Authorization).toBe("Bearer sk-abc");
  });

  it("openai-completions: handles trailing slash on baseUrl", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-abc",
      api: "openai-completions",
    });
    expect(req.url).toBe("https://api.example.com/v1/models");
  });

  it("openai-responses: same shape as openai-completions", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-abc",
      api: "openai-responses",
    });
    expect(req.url).toBe("https://api.example.com/v1/models");
    expect(req.headers.Authorization).toBe("Bearer sk-abc");
  });

  it("anthropic-messages: x-api-key + anthropic-version, no Authorization", () => {
    const req = buildProbeRequest({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-123",
      api: "anthropic-messages",
    });
    expect(req.url).toBe("https://api.anthropic.com/v1/models");
    expect(req.headers["x-api-key"]).toBe("sk-ant-123");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.headers.Authorization).toBeUndefined();
  });

  it("google-generative-ai: key query param, no Authorization", () => {
    const req = buildProbeRequest({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIza abc+def",
      api: "google-generative-ai",
    });
    // apiKey must be URL-encoded
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?key=AIza%20abc%2Bdef",
    );
    expect(req.headers.Authorization).toBeUndefined();
  });

  it("throws on unknown api type", () => {
    expect(() =>
      buildProbeRequest({
        baseUrl: "https://x",
        apiKey: "k",
        api: "unknown-api" as any,
      }),
    ).toThrow(/unsupported api/i);
  });
});

describe("resolveProbeApiKey", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("literal key passes through", () => {
    const result = resolveProbeApiKey({ apiKey: "sk-abc", readProviders: () => ({}) });
    expect(result).toEqual({ ok: true, key: "sk-abc" });
  });

  it("$ENV_VAR: reads from process.env when set", () => {
    process.env.MY_LLM_KEY = "resolved-value";
    const result = resolveProbeApiKey({ apiKey: "$MY_LLM_KEY", readProviders: () => ({}) });
    expect(result).toEqual({ ok: true, key: "resolved-value" });
  });

  it("$ENV_VAR: returns error when env var is missing", () => {
    delete process.env.NONEXISTENT_VAR;
    const result = resolveProbeApiKey({ apiKey: "$NONEXISTENT_VAR", readProviders: () => ({}) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/NONEXISTENT_VAR/);
  });

  it("REDACTED (***): resolves via provider name from readProviders", () => {
    const result = resolveProbeApiKey({
      apiKey: "***",
      name: "my-provider",
      readProviders: () => ({
        "my-provider": { baseUrl: "u", apiKey: "stored-key", api: "openai-completions" },
      }),
    });
    expect(result).toEqual({ ok: true, key: "stored-key" });
  });

  it("REDACTED + stored key is $ENV_VAR: follows env-var resolution", () => {
    process.env.STORED_ENV = "env-value";
    const result = resolveProbeApiKey({
      apiKey: "***",
      name: "my-provider",
      readProviders: () => ({
        "my-provider": { baseUrl: "u", apiKey: "$STORED_ENV", api: "openai-completions" },
      }),
    });
    expect(result).toEqual({ ok: true, key: "env-value" });
  });

  it("REDACTED without name: returns error", () => {
    const result = resolveProbeApiKey({ apiKey: "***", readProviders: () => ({}) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no.*provider/i);
  });

  it("REDACTED with unknown name: returns error", () => {
    const result = resolveProbeApiKey({
      apiKey: "***",
      name: "missing",
      readProviders: () => ({}),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/missing/);
  });

  it("empty key: returns error", () => {
    const result = resolveProbeApiKey({ apiKey: "", readProviders: () => ({}) });
    expect(result.ok).toBe(false);
  });
});

describe("probeProvider", () => {
  const baseInput: ProbeInput = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-abc",
    api: "openai-completions",
  };

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

  it("2xx with data array returns ok + modelCount + sample (capped at 5)", async () => {
    const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
    mockFetch(async () =>
      new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }), { status: 200 }),
    );
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.modelCount).toBe(7);
      expect(result.sample).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    }
  });

  it("2xx with unexpected body shape: ok with modelCount=0", async () => {
    mockFetch(async () => new Response(JSON.stringify({ weird: true }), { status: 200 }));
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.modelCount).toBe(0);
      expect(result.sample).toEqual([]);
    }
  });

  it("401 returns ok=false with status + error", async () => {
    mockFetch(async () =>
      new Response("Invalid API key", { status: 401, statusText: "Unauthorized" }),
    );
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/Invalid API key|Unauthorized|401/);
    }
  });

  it("500 returns ok=false with status", async () => {
    mockFetch(async () => new Response("boom", { status: 500 }));
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
  });

  it("body excerpt is truncated to 500 chars", async () => {
    const long = "x".repeat(2000);
    mockFetch(async () => new Response(long, { status: 400 }));
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok && result.error) expect(result.error.length).toBeLessThanOrEqual(500);
  });

  it("network error: ok=false with error, no status", async () => {
    mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await probeProvider(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ECONNREFUSED/);
      expect(result.status).toBeUndefined();
    }
  });

  it("timeout aborts the request and returns error", async () => {
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = await probeProvider({ ...baseInput, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeDefined();
  });

  it("response never echoes the apiKey", async () => {
    mockFetch(async () =>
      new Response(`echoed sk-abc in body`, { status: 401 }),
    );
    const result = await probeProvider({ ...baseInput, apiKey: "sk-abc" });
    // even though upstream echoes the key, our result error should not leak it
    if (!result.ok && result.error) {
      expect(result.error).not.toContain("sk-abc");
    }
  });

  it("anthropic-messages uses x-api-key header (not Authorization)", async () => {
    let capturedInit: RequestInit | undefined;
    mockFetch(async (_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    await probeProvider({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-x",
      api: "anthropic-messages",
    });
    const headers = capturedInit!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-x");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers.Authorization).toBeUndefined();
  });

  it("google-generative-ai uses ?key= query param (no Authorization)", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    await probeProvider({
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIzaTest",
      api: "google-generative-ai",
    });
    expect(capturedUrl).toContain("?key=AIzaTest");
    const headers = (capturedInit!.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
