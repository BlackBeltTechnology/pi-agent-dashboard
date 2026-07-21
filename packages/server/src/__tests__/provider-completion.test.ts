import { describe, it, expect } from "vitest";
// Pure helpers now live in the shared package; provider-completion re-exports
// them. We exercise the re-exported surface to keep server callers stable.
import {
  buildCompletionRequest,
  extractCompletionText,
  parseTolerantJson,
  summarizeUpstreamError,
} from "../provider-completion.js";

describe("buildCompletionRequest", () => {
  const common = {
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-abc",
    model: "test-model",
    system: "system prompt",
    user: "hello world",
  };

  it("openai-completions: POST /chat/completions with Bearer + messages array", () => {
    const req = buildCompletionRequest({ ...common, api: "openai-completions" });
    expect(req.url).toBe("https://api.example.com/v1/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer sk-abc");
    const body = JSON.parse(req.body);
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "hello world" },
    ]);
    expect(body.temperature).toBe(0);
    expect(body.stream).toBe(false);
    // reasoning_effort is non-standard for chat/completions and rejected by
    // some proxies (e.g. DeepSeek). We don't send it.
    expect(body.reasoning_effort).toBeUndefined();
  });

  it("openai-completions: strips trailing slash on baseUrl", () => {
    const req = buildCompletionRequest({
      ...common,
      baseUrl: "https://api.example.com/v1/",
      api: "openai-completions",
    });
    expect(req.url).toBe("https://api.example.com/v1/chat/completions");
  });

  it("openai-responses: POST /responses with instructions + input", () => {
    const req = buildCompletionRequest({ ...common, api: "openai-responses" });
    expect(req.url).toBe("https://api.example.com/v1/responses");
    expect(req.headers.Authorization).toBe("Bearer sk-abc");
    const body = JSON.parse(req.body);
    expect(body.model).toBe("test-model");
    expect(body.instructions).toBe("system prompt");
    expect(body.input).toBe("hello world");
    expect(body.stream).toBe(false);
    // "low" is the lowest universally-accepted effort value across o-series
    // and proxies; "minimal" is gpt-5.x only and rejected elsewhere.
    expect(body.reasoning).toEqual({ effort: "low" });
  });

  it("anthropic-messages: x-api-key + anthropic-version + system/messages shape", () => {
    const req = buildCompletionRequest({
      ...common,
      baseUrl: "https://api.anthropic.com",
      api: "anthropic-messages",
    });
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-abc");
    expect(req.headers["anthropic-version"]).toBe("2023-06-01");
    expect(req.headers.Authorization).toBeUndefined();
    const body = JSON.parse(req.body);
    expect(body.model).toBe("test-model");
    expect(body.system).toBe("system prompt");
    expect(body.messages).toEqual([{ role: "user", content: "hello world" }]);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.stream).toBe(false);
    // Anthropic extended thinking is opt-in — we deliberately omit `thinking`
    expect(body.thinking).toBeUndefined();
  });

  it("google-generative-ai: model in URL + key query, systemInstruction + contents", () => {
    const req = buildCompletionRequest({
      ...common,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      api: "google-generative-ai",
    });
    expect(req.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent?key=sk-abc",
    );
    expect(req.headers.Authorization).toBeUndefined();
    const body = JSON.parse(req.body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "system prompt" }] });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "hello world" }] },
    ]);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("google-generative-ai: URL-encodes both model and key", () => {
    const req = buildCompletionRequest({
      ...common,
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: "AIza abc+def",
      model: "models/gemini@x",
      api: "google-generative-ai",
    });
    expect(req.url).toContain("models%2Fgemini%40x");
    expect(req.url).toContain("key=AIza%20abc%2Bdef");
  });

  it("respects custom maxTokens", () => {
    const req = buildCompletionRequest({
      ...common,
      api: "anthropic-messages",
      baseUrl: "https://api.anthropic.com",
      maxTokens: 7777,
    });
    const body = JSON.parse(req.body);
    expect(body.max_tokens).toBe(7777);
  });
});

describe("extractCompletionText", () => {
  it("openai-completions: pulls choices[0].message.content", () => {
    expect(
      extractCompletionText("openai-completions", {
        choices: [{ message: { content: "Hello" } }],
      }),
    ).toBe("Hello");
  });

  it("openai-completions: returns null on missing content", () => {
    expect(extractCompletionText("openai-completions", { choices: [] })).toBeNull();
    expect(extractCompletionText("openai-completions", null)).toBeNull();
  });

  it("openai-responses: prefers top-level output_text", () => {
    expect(
      extractCompletionText("openai-responses", { output_text: "Quick" }),
    ).toBe("Quick");
  });

  it("openai-responses: falls back to walking output[].content[].text", () => {
    expect(
      extractCompletionText("openai-responses", {
        output: [{ content: [{ text: "Hel" }, { text: "lo" }] }],
      }),
    ).toBe("Hello");
  });

  it("anthropic-messages: concatenates content[].text where type=text", () => {
    expect(
      extractCompletionText("anthropic-messages", {
        content: [
          { type: "text", text: "Hel" },
          { type: "tool_use" },
          { type: "text", text: "lo" },
        ],
      }),
    ).toBe("Hello");
  });

  it("anthropic-messages: returns null when no text blocks", () => {
    expect(
      extractCompletionText("anthropic-messages", {
        content: [{ type: "tool_use" }],
      }),
    ).toBeNull();
  });

  it("google-generative-ai: pulls candidates[0].content.parts[].text", () => {
    expect(
      extractCompletionText("google-generative-ai", {
        candidates: [{ content: { parts: [{ text: "Hel" }, { text: "lo" }] } }],
      }),
    ).toBe("Hello");
  });

  it("google-generative-ai: returns null when candidates missing", () => {
    expect(extractCompletionText("google-generative-ai", {})).toBeNull();
  });

  it("falls back to OpenAI shape when proxy advertises anthropic but routes to OpenAI backend", () => {
    // LLMproxy quirk: api=anthropic-messages but DeepSeek returns OpenAI shape
    const body = { choices: [{ message: { content: "Hi from OpenAI shape" } }] };
    expect(extractCompletionText("anthropic-messages", body)).toBe(
      "Hi from OpenAI shape",
    );
  });

  it("falls back to anthropic shape when proxy advertises openai but routes to Anthropic backend", () => {
    const body = { content: [{ type: "text", text: "Hi from Anthropic shape" }] };
    expect(extractCompletionText("openai-completions", body)).toBe(
      "Hi from Anthropic shape",
    );
  });

  it("returns null only when NO known shape matches", () => {
    expect(
      extractCompletionText("openai-completions", { weird: "shape" }),
    ).toBeNull();
  });
});

describe("parseTolerantJson", () => {
  it("parses clean JSON", () => {
    expect(parseTolerantJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null on empty/null input", () => {
    expect(parseTolerantJson("")).toBeNull();
  });

  it("strips trailing 'data: [DONE]' SSE marker (LLMproxy quirk)", () => {
    const body =
      '{"content":[{"type":"text","text":"Hi"}]}\ndata: [DONE]\n\n';
    expect(parseTolerantJson(body)).toEqual({
      content: [{ type: "text", text: "Hi" }],
    });
  });

  it("handles balanced braces inside string values when scanning", () => {
    const body = '{"text":"a {b} c"}\ndata: [DONE]';
    expect(parseTolerantJson(body)).toEqual({ text: "a {b} c" });
  });

  it("handles escaped quotes inside string values", () => {
    const body = '{"text":"hello \\"world\\""}\ndata: [DONE]';
    expect(parseTolerantJson(body)).toEqual({ text: 'hello "world"' });
  });

  it("handles full SSE stream — returns last non-[DONE] event", () => {
    const body = [
      'data: {"content":[{"type":"text","text":"H"}]}',
      "",
      'data: {"content":[{"type":"text","text":"Hi"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    expect(parseTolerantJson(body)).toEqual({
      content: [{ type: "text", text: "Hi" }],
    });
  });

  it("returns null on completely garbage input", () => {
    expect(parseTolerantJson("garbage no json here")).toBeNull();
  });
});

describe("summarizeUpstreamError", () => {
  it("detects HTML by content-type and returns friendly message", () => {
    const out = summarizeUpstreamError({
      status: 404,
      contentType: "text/html; charset=utf-8",
      body: "<html><body>nothing</body></html>",
      model: "some-model",
    });
    expect(out).toContain("HTML error page");
    expect(out).toContain("some-model");
    expect(out).toContain("Try a different model");
    // Don't blame embeddings/TTS — the model may just not be routed.
    expect(out.toLowerCase()).not.toContain("embedding");
    expect(out.toLowerCase()).not.toContain("tts");
  });

  it("detects HTML by <!DOCTYPE prefix even without content-type", () => {
    const out = summarizeUpstreamError({
      status: 200,
      contentType: null,
      body: "<!DOCTYPE html><html><head><title>OpenRouter</title></head></html>",
      model: "x",
    });
    expect(out).toContain("HTML error page");
    expect(out).toContain("OpenRouter"); // pulled from <title>
  });

  it("detects HTML by leading <html tag", () => {
    const out = summarizeUpstreamError({
      status: 502,
      contentType: null,
      body: "<html><body>bad gateway</body></html>",
      model: "m",
    });
    expect(out).toContain("HTML error page");
  });

  it("passes through non-HTML body unchanged", () => {
    const out = summarizeUpstreamError({
      status: 401,
      contentType: "application/json",
      body: '{"error":"unauthorized"}',
      model: "m",
    });
    expect(out).toBe('{"error":"unauthorized"}');
  });

  it("falls back to HTTP status on empty body", () => {
    const out = summarizeUpstreamError({
      status: 503,
      contentType: null,
      body: "",
      model: "m",
    });
    expect(out).toBe("HTTP 503");
  });
});
