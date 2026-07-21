import { describe, it, expect, vi } from "vitest";
import {
  parseModelRef,
  inferApiType,
  inferBaseUrl,
  handleTranslateRequest,
} from "../translate-handler.js";

describe("parseModelRef", () => {
  it("splits provider/id with first slash", () => {
    expect(parseModelRef("anthropic/claude-haiku-4-5")).toEqual({
      provider: "anthropic",
      id: "claude-haiku-4-5",
    });
  });

  it("supports model ids that themselves contain slashes", () => {
    // e.g. "openrouter/openai/gpt-4o" → provider=openrouter, id=openai/gpt-4o
    expect(parseModelRef("openrouter/openai/gpt-4o")).toEqual({
      provider: "openrouter",
      id: "openai/gpt-4o",
    });
  });

  it("returns null on no slash", () => {
    expect(parseModelRef("nomeaning")).toBeNull();
  });

  it("returns null on leading or trailing slash", () => {
    expect(parseModelRef("/foo")).toBeNull();
    expect(parseModelRef("foo/")).toBeNull();
  });
});

describe("inferApiType", () => {
  it("reads model.api directly", () => {
    expect(inferApiType({ api: "anthropic-messages" })).toBe("anthropic-messages");
  });

  it("falls back to model.provider.api", () => {
    expect(
      inferApiType({ provider: { api: "openai-completions" } }),
    ).toBe("openai-completions");
  });

  it("falls back to model.providerConfig.api", () => {
    expect(
      inferApiType({ providerConfig: { api: "google-generative-ai" } }),
    ).toBe("google-generative-ai");
  });

  it("returns null on unknown values", () => {
    expect(inferApiType({ api: "weirdo" })).toBeNull();
    expect(inferApiType({})).toBeNull();
  });
});

describe("inferBaseUrl", () => {
  it("returns override when present", () => {
    expect(
      inferBaseUrl({ baseUrl: "x" }, "anthropic-messages", "https://override"),
    ).toBe("https://override");
  });

  it("reads from model.baseUrl", () => {
    expect(inferBaseUrl({ baseUrl: "https://foo" }, "anthropic-messages")).toBe(
      "https://foo",
    );
  });

  it("falls back to standard anthropic default", () => {
    expect(inferBaseUrl({}, "anthropic-messages")).toBe(
      "https://api.anthropic.com",
    );
  });

  it("falls back to openai default for both completions and responses", () => {
    expect(inferBaseUrl({}, "openai-completions")).toBe(
      "https://api.openai.com/v1",
    );
    expect(inferBaseUrl({}, "openai-responses")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("falls back to google v1beta default", () => {
    expect(inferBaseUrl({}, "google-generative-ai")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });
});

describe("handleTranslateRequest", () => {
  function makeFetch(response: {
    ok?: boolean;
    status?: number;
    text?: string;
    contentType?: string | null;
  }) {
    const headers = new Map<string, string>();
    if (response.contentType) headers.set("content-type", response.contentType);
    return vi.fn(async () => ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      text: async () => response.text ?? "",
    }));
  }

  it("replies with error when modelRegistry is missing", async () => {
    const send = vi.fn();
    await handleTranslateRequest(
      { type: "translate_request", requestId: "r1", modelRef: "p/m", system: "s", user: "u" },
      { modelRegistry: null, send },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      requestId: "r1",
      ok: false,
    });
    expect(send.mock.calls[0]![0].error).toContain("modelRegistry");
  });

  it("replies with error on invalid modelRef shape", async () => {
    const send = vi.fn();
    const modelRegistry = { find: vi.fn() };
    await handleTranslateRequest(
      { type: "translate_request", requestId: "r2", modelRef: "noslash", system: "s", user: "u" },
      { modelRegistry, send },
    );
    expect(send.mock.calls[0]![0].error).toContain("Invalid modelRef");
    expect(modelRegistry.find).not.toHaveBeenCalled();
  });

  it("replies with error when model is not in registry", async () => {
    const send = vi.fn();
    const modelRegistry = {
      find: vi.fn(() => null),
      getAll: vi.fn(() => []),
    };
    await handleTranslateRequest(
      { type: "translate_request", requestId: "r3", modelRef: "p/m", system: "s", user: "u" },
      { modelRegistry, send },
    );
    expect(send.mock.calls[0]![0].error).toContain("not found");
  });

  it("replies with error when api type is unknown", async () => {
    const send = vi.fn();
    const modelRegistry = {
      find: vi.fn(() => ({ id: "m", provider: { api: undefined } })),
      getApiKeyAndHeaders: vi.fn(),
    };
    await handleTranslateRequest(
      { type: "translate_request", requestId: "r4", modelRef: "p/m", system: "s", user: "u" },
      { modelRegistry, send },
    );
    expect(send.mock.calls[0]![0].error).toContain("api type");
  });

  it("propagates auth failure as error", async () => {
    const send = vi.fn();
    const modelRegistry = {
      find: vi.fn(() => ({ id: "m", api: "anthropic-messages" })),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: false, error: "no token" })),
    };
    await handleTranslateRequest(
      { type: "translate_request", requestId: "r5", modelRef: "p/m", system: "s", user: "u" },
      { modelRegistry, send },
    );
    expect(send.mock.calls[0]![0]).toMatchObject({ ok: false });
    expect(send.mock.calls[0]![0].error).toBe("no token");
  });

  it("happy path: anthropic-messages → POST + extract text", async () => {
    const send = vi.fn();
    const fetchImpl = makeFetch({
      ok: true,
      status: 200,
      text: '{"content":[{"type":"text","text":"Hi"}]}',
    });
    const modelRegistry = {
      find: vi.fn(() => ({
        id: "claude-haiku",
        api: "anthropic-messages",
        baseUrl: "https://example.com",
      })),
      getApiKeyAndHeaders: vi.fn(async () => ({
        ok: true,
        apiKey: "k",
        headers: { "x-anthropic-beta": "test" },
      })),
    };
    await handleTranslateRequest(
      {
        type: "translate_request",
        requestId: "rok",
        modelRef: "anthropic/claude-haiku",
        system: "translate",
        user: "Szia",
      },
      { modelRegistry, send, fetch: fetchImpl as any },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/v1/messages");
    expect(init.method).toBe("POST");
    // extraHeaders merged on top of standard ones
    expect((init.headers as any)["x-anthropic-beta"]).toBe("test");
    expect((init.headers as any)["anthropic-version"]).toBe("2023-06-01");
    expect(send).toHaveBeenCalledWith({
      type: "translate_response",
      requestId: "rok",
      ok: true,
      text: "Hi",
    });
  });

  it("propagates upstream HTML error with friendly summary", async () => {
    const send = vi.fn();
    const fetchImpl = makeFetch({
      ok: false,
      status: 404,
      contentType: "text/html",
      text: "<html><head><title>Not Found</title></head></html>",
    });
    const modelRegistry = {
      find: vi.fn(() => ({ id: "m", api: "anthropic-messages" })),
      getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "k", headers: {} })),
    };
    await handleTranslateRequest(
      { type: "translate_request", requestId: "rerr", modelRef: "p/m", system: "s", user: "u" },
      { modelRegistry, send, fetch: fetchImpl as any },
    );
    const reply = send.mock.calls[0]![0];
    expect(reply.ok).toBe(false);
    expect(reply.status).toBe(404);
    expect(reply.error).toContain("HTML error page");
    expect(reply.error).toContain("Not Found");
  });
});
