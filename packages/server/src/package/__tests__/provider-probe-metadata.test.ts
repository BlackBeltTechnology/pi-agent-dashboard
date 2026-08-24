/**
 * Metadata-preserving custom-provider discovery: `listProviderModels` returns
 * per-model records carrying every capability field the provider advertised,
 * mapped by RESPONSE SHAPE (not the configured `api`), with per-field
 * validation and no upper sanity bound on advertised numerics.
 *
 * The ids-only helpers (`listProviderModelIds`, `probeProvider`) are asserted
 * unchanged in the same file so a future widening of one cannot silently
 * regress the Test button.
 *
 * See change: fix-custom-provider-model-metadata (test-plan E1/E2/E3/E4/E5/E6/E7/E9/E11, X1/X3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { listProviderModelIds, listProviderModels, type ProbeApi, probeProvider } from "../provider-probe.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Stub `/v1/models` with a JSON body. */
function serve(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  ) as any;
}

function input(api: ProbeApi = "openai-completions") {
  return { baseUrl: "https://proxy.example/v1", apiKey: "sk-test", api };
}

async function discover(body: unknown, api: ProbeApi = "openai-completions") {
  serve(body);
  return listProviderModels(input(api));
}

/** The live 9router probe recorded in the design doc. */
const NINE_ROUTER_BODY = {
  data: [
    {
      id: "cc/claude-opus-5",
      object: "model",
      owned_by: "cc",
      context_length: 1_000_000,
      max_completion_tokens: 128_000,
      capabilities: { reasoning: true, vision: true },
    },
  ],
};

describe("listProviderModels — advertised metadata survives discovery (E1)", () => {
  it("reports ctx, maxTokens, reasoning and image input from the provider body", async () => {
    const models = await discover(NINE_ROUTER_BODY);

    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m.id).toBe("cc/claude-opus-5");
    expect(m.advertised.contextWindow).toBe(1_000_000);
    expect(m.advertised.maxTokens).toBe(128_000);
    expect(m.advertised.reasoning).toBe(true);
    expect(m.advertised.input).toContain("image");
  });
});

describe("ids-only helpers are unchanged (E2)", () => {
  it("listProviderModelIds still returns a string[] of ids", async () => {
    serve(NINE_ROUTER_BODY);
    const ids = await listProviderModelIds(input());
    expect(ids).toEqual(["cc/claude-opus-5"]);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
  });

  it("probeProvider still returns {ok,status,modelCount,sample} with sample capped at 5", async () => {
    serve({ data: Array.from({ length: 9 }, (_, i) => ({ id: `m-${i}` })) });
    const res = await probeProvider(input());
    expect(res).toMatchObject({ ok: true, status: 200, modelCount: 9 });
    expect(res.ok && res.sample).toHaveLength(5);
  });
});

describe("mapping is keyed on response shape, not the configured api (E3, E4)", () => {
  it("maps an OpenAI-shaped body from an anthropic-messages provider (E3)", async () => {
    const models = await discover(
      { data: [{ id: "cc/claude-opus-5", context_length: 1_000_000, capabilities: { reasoning: true } }] },
      "anthropic-messages",
    );

    // Proves the configured `api` did not gate the mapping: an api-keyed
    // mapper would have skipped this body entirely and left the floors.
    expect(models[0].advertised.contextWindow).toBe(1_000_000);
    expect(models[0].advertised.reasoning).toBe(true);
  });

  it("maps a Google-shaped body, stripping the models/ prefix (E4)", async () => {
    const models = await discover(
      { models: [{ name: "models/gemini-x", inputTokenLimit: 1_048_576, outputTokenLimit: 65_536 }] },
      "google-generative-ai",
    );

    expect(models[0].id).toBe("gemini-x");
    expect(models[0].advertised.contextWindow).toBe(1_048_576);
    expect(models[0].advertised.maxTokens).toBe(65_536);
  });
});

describe("top-level scalar wins over its capabilities twin (E5, E6)", () => {
  it("context_length beats capabilities.contextWindow when both are present (E5)", async () => {
    const models = await discover({
      data: [{ id: "m", context_length: 1_000_000, capabilities: { contextWindow: 200_000 } }],
    });
    expect(models[0].advertised.contextWindow).toBe(1_000_000);
  });

  it("uses the capabilities twin when the top-level scalar is absent (E6)", async () => {
    const models = await discover({ data: [{ id: "m", capabilities: { maxOutput: 128_000 } }] });
    expect(models[0].advertised.maxTokens).toBe(128_000);
  });
});

describe("unrepresentable modalities are dropped (E7)", () => {
  it("maps vision to image and ignores pdf/audio/video/search", async () => {
    const models = await discover({
      data: [
        {
          id: "m",
          capabilities: {
            vision: true, pdf: true, audioInput: true, videoInput: true,
            imageOutput: true, audioOutput: true, search: true,
          },
        },
      ],
    });
    expect(models[0].advertised.input).toEqual(["text", "image"]);
  });

  it("maps vision:false to text-only input", async () => {
    const models = await discover({ data: [{ id: "m", capabilities: { vision: false } }] });
    expect(models[0].advertised.input).toEqual(["text"]);
  });
});

describe("per-field validation (E9) — malformed rejected, absurd-but-finite adopted", () => {
  it("treats string / zero / negative / null capacities as not advertised", async () => {
    const models = await discover({
      data: [
        { id: "str", context_length: "1000000" },
        { id: "zero", context_length: 0 },
        { id: "neg", context_length: -5 },
        { id: "nul", context_length: null },
      ],
    });

    expect(models).toHaveLength(4);
    // Not advertised → the caller's api-typed floor applies for that field.
    for (const m of models) expect(m.advertised.contextWindow).toBeUndefined();
  });

  it("adopts an absurd-but-finite value (C2: no upper bound) without throwing", async () => {
    const models = await discover({ data: [{ id: "huge", context_length: 999_999_999_999 }] });
    expect(models[0].advertised.contextWindow).toBe(999_999_999_999);
  });

  it("ignores a non-boolean reasoning flag", async () => {
    const models = await discover({ data: [{ id: "m", capabilities: { reasoning: "yes" } }] });
    expect(models[0].advertised.reasoning).toBeUndefined();
  });
});

describe("silent model advertises nothing (E10 ingestion half)", () => {
  it("returns an empty advertised record for a bare id", async () => {
    const models = await discover({ data: [{ id: "bare-model" }] });
    expect(models[0].id).toBe("bare-model");
    expect(models[0].advertised).toEqual({});
  });
});

describe("thinking capability is adopted only as `reasoning` (E11 ingestion half)", () => {
  it("adopts reasoning and synthesizes no thinking level map from a null range", async () => {
    const models = await discover({
      data: [
        {
          id: "m",
          capabilities: {
            reasoning: true, thinkingFormat: "claude-adaptive",
            thinkingCanDisable: true, thinkingRange: null,
          },
        },
      ],
    });

    expect(models[0].advertised.reasoning).toBe(true);
    expect(models[0].advertised).not.toHaveProperty("thinkingLevelMap");
  });
});

describe("discovery degrades gracefully (X1, X3)", () => {
  it("returns no models on HTTP 500 and does not throw (X1)", async () => {
    serve({ error: "boom" }, 500);
    await expect(listProviderModels(input())).resolves.toEqual([]);
  });

  it("returns no models for a non-JSON body (X3)", async () => {
    globalThis.fetch = vi.fn(async () => new Response("<html>nope</html>", { status: 200 })) as any;
    await expect(listProviderModels(input())).resolves.toEqual([]);
  });

  it.each([
    ["empty object", {}],
    ["data is not an array", { data: "nope" }],
    ["null body", null],
    ["array body", []],
  ])("returns no models for a malformed body: %s (X3)", async (_label, body) => {
    serve(body);
    await expect(listProviderModels(input())).resolves.toEqual([]);
  });

  it("returns no models when the fetch itself rejects, without throwing", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    await expect(listProviderModels(input())).resolves.toEqual([]);
  });
});

// ── Discovery-level degradation (X2, X5) ─────────────────────────────────

describe("discoverProviderModels — degradation at the discovery layer", () => {
  it("yields no models and does not throw for an unresolvable $ENV key (X5)", async () => {
    const { discoverProviderModels } = await import("../../model-proxy/custom-provider-discovery.js");
    delete process.env.MISSING_ENV_FOR_TEST;
    const spy = vi.fn();
    globalThis.fetch = spy as any;

    await expect(
      discoverProviderModels("proxy", {
        baseUrl: "https://p/v1",
        apiKey: "$MISSING_ENV_FOR_TEST",
        api: "openai-completions",
      }),
    ).resolves.toEqual([]);
    // Never even attempted the request, so no credential can reach the wire.
    expect(spy).not.toHaveBeenCalled();
  });

  it("yields no models for a blank baseUrl", async () => {
    const { discoverProviderModels } = await import("../../model-proxy/custom-provider-discovery.js");
    await expect(
      discoverProviderModels("proxy", { baseUrl: "  ", apiKey: "k", api: "openai-completions" }),
    ).resolves.toEqual([]);
  });

  it("aborts at the discovery timeout without throwing or leaving a rejection (X2)", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as any;

    await expect(
      listProviderModels({ ...input(), timeoutMs: 10 }),
    ).resolves.toEqual([]);
  });

  it("applies api-typed floors per field, keeping advertised ones (E8/E10)", async () => {
    const { discoverProviderModels } = await import("../../model-proxy/custom-provider-discovery.js");
    serve({
      data: [
        { id: "hybrid-model", capabilities: { reasoning: true } },
        { id: "bare-model" },
      ],
    });

    const models = await discoverProviderModels("proxy", {
      baseUrl: "https://p/v1",
      apiKey: "k",
      api: "anthropic-messages",
    });

    const hybrid = models.find((m) => m.id === "hybrid-model")!;
    expect(hybrid.reasoning).toBe(true); // endpoint
    expect(hybrid.contextWindow).toBe(200_000); // anthropic-messages floor
    expect(hybrid.maxTokens).toBe(64_000);
    expect(hybrid.metadataSource).toBe("fallback"); // weakest adopted tier

    const bare = models.find((m) => m.id === "bare-model")!;
    expect(bare).toMatchObject({
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: false,
      input: ["text"],
      metadataSource: "fallback",
    });
  });

  it("stamps a fully-advertised model as endpoint provenance (E19)", async () => {
    const { discoverProviderModels } = await import("../../model-proxy/custom-provider-discovery.js");
    serve(NINE_ROUTER_BODY);
    const models = await discoverProviderModels("proxy", {
      baseUrl: "https://p/v1",
      apiKey: "k",
      api: "anthropic-messages",
    });
    expect(models[0]).toMatchObject({
      id: "cc/claude-opus-5",
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      reasoning: true,
      metadataSource: "endpoint",
    });
  });
});
