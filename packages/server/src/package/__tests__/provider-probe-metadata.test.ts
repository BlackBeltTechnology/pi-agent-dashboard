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
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverProviderModels } from "../../model-proxy/custom-provider-discovery.js";
import type { LookupAll } from "../../push/push-transports/webhook-url.js";
import {
  listProviderModelIds,
  listProviderModels,
  type ProbeApi,
  probeProvider,
  setProbeLookupAll,
  setProbeSelfPort,
} from "../provider-probe.js";

const originalFetch = globalThis.fetch;
const PUBLIC_ADDR = [{ address: "93.184.216.34", family: 4 as const }];
// Fixture hosts do not resolve; give the egress vet a public answer by default.
beforeEach(() => {
  setProbeLookupAll(async () => PUBLIC_ADDR);
  setProbeSelfPort(() => null);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  setProbeLookupAll(null);
  setProbeSelfPort(() => null);
  vi.useRealTimers();
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

// -- NET-04: provider egress vet (test-plan E101, E104-E109, E114, E139, X30, X33) --
// See change: close-local-listener-and-egress-gaps (design D7).

const METADATA_ERR = "provider target is a link-local or metadata address";
const SELF_ERR = "provider target is this dashboard";

describe("provider egress vet", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }));
    globalThis.fetch = fetchSpy as any;
  });
  const probe = (baseUrl: string) => probeProvider({ baseUrl, apiKey: "sk-lit", api: "openai-completions" });

  it("refuses the metadata address set with no request (E101)", async () => {
    setProbeLookupAll(async (h) =>
      h === "metadata.google.internal" ? [{ address: "169.254.169.254", family: 4 }] : PUBLIC_ADDR,
    );
    for (const url of [
      "http://169.254.170.2/",
      "http://[fd00:ec2::254]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[fe80::1]/",
      "http://metadata.google.internal/",
    ]) {
      const r = await probe(url);
      expect(r, url).toEqual({ ok: false, error: METADATA_ERR });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("IPv4 link-local boundaries (E104)", async () => {
    for (const host of ["169.254.0.0", "169.254.169.254", "169.254.255.255"]) {
      expect(await probe(`http://${host}/`), host).toEqual({ ok: false, error: METADATA_ERR });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const host of ["169.253.255.255", "169.255.0.0"]) {
      expect((await probe(`http://${host}/`)).ok, host).toBe(true);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("IPv6 link-local boundaries (E105)", async () => {
    for (const host of ["[fe80::1]", "[febf:ffff::1]", "[fd00:ec2::254]"]) {
      expect(await probe(`http://${host}/`), host).toEqual({ ok: false, error: METADATA_ERR });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const host of ["[fec0::1]", "[fe7f::1]"]) {
      expect((await probe(`http://${host}/`)).ok, host).toBe(true);
    }
  });

  it("refuses obfuscated spellings of the metadata IP (E106)", async () => {
    for (const url of [
      "http://2852039166/",
      "http://0xa9fea9fe/",
      "http://0251.0376.0251.0376/",
      "http://169.254.169.254./",
      "http://[::ffff:169.254.169.254]/",
      "http://[::ffff:a9fe:a9fe]/",
    ]) {
      expect(await probe(url), url).toEqual({ ok: false, error: METADATA_ERR });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("DNS outcomes: any blocked address refuses; lookup failure has no status (E107)", async () => {
    const answers: Record<string, ReturnType<LookupAll> | (() => never)> = {
      "a.test": Promise.resolve([{ address: "169.254.169.254", family: 4 }]),
      "b.test": Promise.resolve([
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
      "c.test": Promise.resolve(PUBLIC_ADDR),
      "d.test": Promise.resolve([]),
    };
    setProbeLookupAll(async (h) => {
      if (h === "e.test") throw new Error("ENOTFOUND");
      return answers[h] as any;
    });
    expect(await probe("http://a.test/")).toEqual({ ok: false, error: METADATA_ERR });
    expect(await probe("http://b.test/")).toEqual({ ok: false, error: METADATA_ERR });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await probe("http://c.test/")).ok).toBe(true);
    for (const h of ["d.test", "e.test"]) {
      const r = await probe(`http://${h}/`);
      expect(r.ok).toBe(false);
      expect("status" in r).toBe(false);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("own-port forms are refused (E108)", async () => {
    const P = 18123;
    setProbeSelfPort(() => P);
    setProbeLookupAll(async (h) => (h === "localhost" ? [{ address: "127.0.0.1", family: 4 }] : PUBLIC_ADDR));
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    const forms = [
      `http://127.0.0.1:${P}`,
      `http://localhost:${P}`,
      `http://[::1]:${P}`,
      `http://0.0.0.0:${P}`,
      `http://127.0.0.2:${P}`,
      `http://[::ffff:127.0.0.1]:${P}`,
      ...(lan ? [`http://${lan}:${P}`] : []),
    ];
    for (const url of forms) expect(await probe(url), url).toEqual({ ok: false, error: SELF_ERR });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("own-port boundaries: neighbours, public host, elided ports, unset getter (E109)", async () => {
    setProbeLookupAll(async (h) => (h === "localhost" ? [{ address: "127.0.0.1", family: 4 }] : PUBLIC_ADDR));
    setProbeSelfPort(() => 18123);
    for (const url of ["http://127.0.0.1:18122", "http://127.0.0.1:18124", "http://public.test:18123"]) {
      expect((await probe(url)).ok, url).toBe(true);
    }
    setProbeSelfPort(() => 80);
    expect(await probe("http://localhost")).toEqual({ ok: false, error: SELF_ERR });
    setProbeSelfPort(() => 443);
    expect(await probe("https://localhost")).toEqual({ ok: false, error: SELF_ERR });
    setProbeSelfPort(() => null);
    expect((await probe("http://127.0.0.1:18123")).ok).toBe(true);
    // metadata rule stays on with no self-port getter
    expect(await probe("http://169.254.169.254/")).toEqual({ ok: false, error: METADATA_ERR });
  });

  it("allows loopback-by-name and LAN targets (E110)", async () => {
    for (const url of ["http://localhost:11434/v1", "http://192.168.1.10:8080", "http://10.0.0.5", "http://172.16.0.9"]) {
      expect((await probe(url)).ok, url).toBe(true);
    }
  });

  it("discovery returns no models and sends no request for a refused provider (E114)", async () => {
    const input = { baseUrl: "http://169.254.169.254/", apiKey: "k", api: "openai-completions" as const };
    expect(await listProviderModels(input)).toEqual([]);
    expect(await listProviderModelIds(input)).toEqual([]);
    expect(await discoverProviderModels("p", { baseUrl: "http://169.254.169.254/", apiKey: "k", api: "openai-completions" })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("partial refusal: vetted providers still discover, the refused one is [] (X33)", async () => {
    const entry = (baseUrl: string) => ({ baseUrl, apiKey: "k", api: "openai-completions" });
    const [a, bad, c] = await Promise.all([
      discoverProviderModels("a", entry("https://a.example/v1")),
      discoverProviderModels("bad", entry("http://169.254.169.254/v1")),
      discoverProviderModels("c", entry("https://c.example/v1")),
    ]);
    expect(a.map((m) => m.id)).toEqual(["m1"]);
    expect(bad).toEqual([]);
    expect(c.map((m) => m.id)).toEqual(["m1"]);
    const hosts = fetchSpy.mock.calls.map((c) => new URL(String(c[0])).hostname);
    expect(hosts).not.toContain("169.254.169.254");
  });

  it("logs one host-only warn per refusal, never key / path / query (E139)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await probeProvider({ baseUrl: "http://169.254.169.254/x?key=SECRET", apiKey: "SECRET2", api: "openai-completions" });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls.flat().join(" ");
    expect(line).toContain("169.254.169.254");
    for (const bad of ["SECRET", "SECRET2", "/x", "key="]) expect(line).not.toContain(bad);
  });

  it("a stalled DNS lookup ends at the shared 8 s budget with no request (X30)", async () => {
    vi.useFakeTimers();
    setProbeLookupAll(() => new Promise(() => {}));
    const input = { baseUrl: "https://stalled.example/v1", apiKey: "k", api: "openai-completions" as const };
    const probed = probeProvider(input);
    const listed = listProviderModels(input);
    await vi.advanceTimersByTimeAsync(8000);
    const r = await probed;
    expect(r.ok).toBe(false);
    expect("status" in r).toBe(false);
    expect(await listed).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
