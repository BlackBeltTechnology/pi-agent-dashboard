/**
 * Tests for enrichModelMetadata — the pure helper that resolves a discovered
 * custom-provider model id against a catalog probe (typically backed by pi's
 * `modelRegistry.find(provider, id)`) and falls back to api-appropriate
 * defaults when the probe has no match.
 *
 * The helper takes an optional `probe` parameter so unit tests can supply a
 * fake catalog without needing `@earendil-works/pi-ai` installed — in
 * production, registerEntry() injects `modelRegistry.find` as the probe.
 *
 * Spec: openspec/changes/enrich-custom-provider-model-metadata/specs/provider-auth-bridge/spec.md
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CatalogProbe, enrichModelMetadata } from "../provider-register.js";

// Minimal fake catalog mirroring a subset of pi-ai's real MODELS export.
// Keys are `${provider}|${id}` so our probe is a single Map lookup.
const FAKE_CATALOG = new Map<string, any>([
  [
    "anthropic|claude-opus-4-7",
    {
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      reasoning: true,
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      input: ["text", "image"],
    },
  ],
  [
    "anthropic|claude-sonnet-4-6",
    {
      contextWindow: 1_000_000,
      maxTokens: 64_000,
      reasoning: true,
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      input: ["text", "image"],
    },
  ],
  [
    "anthropic|claude-haiku-4-5",
    {
      contextWindow: 200_000,
      maxTokens: 64_000,
      reasoning: true,
      cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      input: ["text", "image"],
    },
  ],
  [
    "openai|gpt-5",
    {
      contextWindow: 400_000,
      maxTokens: 128_000,
      reasoning: true,
      cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      input: ["text", "image"],
    },
  ],
  [
    "opencode|claude-opus-4-7",
    {
      // Deliberately different values so tests can prove the candidate-
      // provider probe order is deterministic (anthropic checked first).
      contextWindow: 999,
      maxTokens: 1,
      reasoning: true,
      cost: { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
      input: ["text"],
    },
  ],
]);

const fakeProbe: CatalogProbe = (provider, id) =>
  FAKE_CATALOG.get(`${provider}|${id}`) ?? null;

describe("enrichModelMetadata — catalog matches via probe", () => {
  it("resolves `cc/claude-opus-4-7` + anthropic-messages to Opus 4.7 catalog entry (1M ctx)", () => {
    const result = enrichModelMetadata("cc/claude-opus-4-7", "anthropic-messages", fakeProbe);
    expect(result.contextWindow).toBe(1_000_000);
    expect(result.maxTokens).toBe(128_000);
    expect(result.reasoning).toBe(true);
    expect(result.cost).toEqual({
      input: 5,
      output: 25,
      cacheRead: 0.5,
      cacheWrite: 6.25,
    });
    expect(result.input).toEqual(["text", "image"]);
  });

  it("resolves bare `claude-sonnet-4-6` + anthropic-messages to Sonnet 4.6 (1M ctx)", () => {
    const result = enrichModelMetadata("claude-sonnet-4-6", "anthropic-messages", fakeProbe);
    expect(result.contextWindow).toBe(1_000_000);
    expect(result.reasoning).toBe(true);
  });

  it("resolves `anthropic/claude-opus-4-7` prefix to Opus 4.7 (1M ctx)", () => {
    const result = enrichModelMetadata("anthropic/claude-opus-4-7", "anthropic-messages", fakeProbe);
    expect(result.contextWindow).toBe(1_000_000);
    expect(result.maxTokens).toBe(128_000);
  });

  it("resolves `claude-haiku-4-5` + anthropic-messages to Haiku 4.5 (200k ctx — verifies we don't over-claim)", () => {
    const result = enrichModelMetadata("claude-haiku-4-5", "anthropic-messages", fakeProbe);
    expect(result.contextWindow).toBe(200_000);
    expect(result.reasoning).toBe(true);
    expect(result.cost.input).toBe(1);
    expect(result.cost.output).toBe(5);
  });

  it("resolves `openrouter/openai/gpt-5` prefix to gpt-5 via openai-completions candidates", () => {
    const result = enrichModelMetadata("openrouter/openai/gpt-5", "openai-completions", fakeProbe);
    expect(result.contextWindow).toBe(400_000);
    expect(result.maxTokens).toBe(128_000);
    expect(result.reasoning).toBe(true);
  });
});

describe("enrichModelMetadata — fallback defaults (no probe or no match)", () => {
  it("no probe supplied → falls back to api-appropriate default", () => {
    const result = enrichModelMetadata("cc/claude-opus-4-7", "anthropic-messages");
    expect(result.contextWindow).toBe(200_000);
    expect(result.maxTokens).toBe(64_000);
  });

  it("unknown id + anthropic-messages returns 200k / 64k / no reasoning / zero cost / text+image", () => {
    const result = enrichModelMetadata("some-unknown-anthropic-model", "anthropic-messages", fakeProbe);
    expect(result.contextWindow).toBe(200_000);
    expect(result.maxTokens).toBe(64_000);
    expect(result.reasoning).toBe(false);
    expect(result.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(result.input).toEqual(["text", "image"]);
  });

  it("unknown id + openai-completions returns 128k / 16k / zero cost / text+image", () => {
    const result = enrichModelMetadata("some-unknown-openai-model", "openai-completions", fakeProbe);
    expect(result.contextWindow).toBe(128_000);
    expect(result.maxTokens).toBe(16_384);
    expect(result.reasoning).toBe(false);
    expect(result.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(result.input).toEqual(["text", "image"]);
  });

  it("unknown id + google-generative-ai returns 1M / 65k / zero cost / text+image", () => {
    const result = enrichModelMetadata("some-unknown-gemini-model", "google-generative-ai", fakeProbe);
    expect(result.contextWindow).toBe(1_000_000);
    expect(result.maxTokens).toBe(65_536);
    expect(result.reasoning).toBe(false);
    expect(result.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(result.input).toEqual(["text", "image"]);
  });

  it("prefixed unknown + openai-completions falls back (both prefixed and bare miss)", () => {
    const result = enrichModelMetadata("minimax/custom-private-model", "openai-completions", fakeProbe);
    expect(result.contextWindow).toBe(128_000);
    expect(result.maxTokens).toBe(16_384);
    expect(result.cost.input).toBe(0);
  });

  it("no api argument + no probe defaults to openai-completions fallback", () => {
    const result = enrichModelMetadata("some-unknown-model");
    expect(result.contextWindow).toBe(128_000);
    expect(result.maxTokens).toBe(16_384);
    expect(result.input).toEqual(["text", "image"]);
  });

  it("unknown api string + probe still probes openai-completions candidates", () => {
    const result = enrichModelMetadata("some-unknown-model", "some-weird-api", fakeProbe);
    expect(result.contextWindow).toBe(128_000);
  });

  it("probe that throws is tolerated (falls through to fallback)", () => {
    const throwingProbe: CatalogProbe = () => {
      throw new Error("registry not ready");
    };
    const result = enrichModelMetadata("claude-opus-4-7", "anthropic-messages", throwingProbe);
    expect(result.contextWindow).toBe(200_000); // anthropic-messages fallback
  });
});

describe("enrichModelMetadata — probe order determinism", () => {
  it("prefers `anthropic` over `opencode` for anthropic-messages (first in candidate list wins)", () => {
    // The fake catalog has `claude-opus-4-7` under BOTH `anthropic` (1M) and
    // `opencode` (999). With api=anthropic-messages, candidates = ["anthropic", "opencode"]
    // so the anthropic entry must win.
    const result = enrichModelMetadata("claude-opus-4-7", "anthropic-messages", fakeProbe);
    expect(result.contextWindow).toBe(1_000_000);
    expect(result.maxTokens).toBe(128_000);
  });

  it("multi-segment prefix `openrouter/anthropic/claude-opus-4-7` resolves via bare-id lookup", () => {
    // After stripping the last segment, `claude-opus-4-7` matches `anthropic` (1M).
    const result = enrichModelMetadata(
      "openrouter/anthropic/claude-opus-4-7",
      "anthropic-messages",
      fakeProbe,
    );
    expect(result.contextWindow).toBe(1_000_000);
  });
});

// See change: enrich-model-selector-capabilities-favorites.
describe("enrichModelMetadata — metadataSource discriminator", () => {
  it("flags catalog matches as metadataSource: 'catalog'", () => {
    const result = enrichModelMetadata("cc/claude-opus-4-7", "anthropic-messages", fakeProbe);
    expect(result.metadataSource).toBe("catalog");
  });

  it("flags unmatched custom models as metadataSource: 'fallback'", () => {
    // Upstream reports no capability data; no catalog match → forced defaults.
    const result = enrichModelMetadata("glm/glm-5.1", "anthropic-messages", fakeProbe);
    expect(result.metadataSource).toBe("fallback");
    expect(result.input).toEqual(["text", "image"]); // forced image-capable
    expect(result.reasoning).toBe(false); // forced false
  });

  it("flags no-probe path as metadataSource: 'fallback'", () => {
    const result = enrichModelMetadata("some-model", "openai-completions", null);
    expect(result.metadataSource).toBe("fallback");
  });
});

// ── In-session surface: endpoint-advertised metadata ──────────────────────
//
// `resolveMetadata` is internal, so these drive the real path end-to-end
// through `reloadProviders` → `registerEntry` with a stubbed `/v1/models` and
// an injected catalog probe (captured via a fake `ctx.modelRegistry`).
// See change: fix-custom-provider-model-metadata (test-plan E19/E20/E21/E22).

describe("registerEntry — advertised metadata outranks the catalog probe", () => {
  let tmpHome: string;
  const originalHome = process.env.HOME;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "provider-endpoint-"));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, ".pi", "agent"), { recursive: true });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writeProviders(providers: Record<string, unknown>): void {
    writeFileSync(
      join(tmpHome, ".pi", "agent", "providers.json"),
      JSON.stringify({ providers }, null, 2),
      "utf-8",
    );
  }

  /**
   * Run activate() + session_start so the module captures a modelRegistry
   * whose `find` is backed by FAKE_CATALOG (the name-matched catalog probe),
   * then registerEntry re-runs with that probe available.
   */
  async function registerWith(body: unknown): Promise<any> {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as any;
    vi.resetModules();
    const mod = await import("../provider-register.js");

    const registerProvider = vi.fn();
    const handlers = new Map<string, (e: any, c: any) => Promise<void>>();
    const pi: any = {
      registerProvider,
      unregisterProvider: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn() },
      on: (name: string, fn: any) => handlers.set(name, fn),
    };

    mod.activate(pi);
    const modelRegistry = { find: (provider: string, id: string) => FAKE_CATALOG.get(`${provider}|${id}`) ?? null };
    await handlers.get("session_start")?.({}, { modelRegistry, ui: { notify: vi.fn() } });

    const calls = registerProvider.mock.calls.filter((c: any[]) => c[0] === "proxy" && c[1]?.models);
    return calls[calls.length - 1]?.[1];
  }

  it("endpoint ctx beats the name-matched catalog guess (E21)", async () => {
    writeProviders({ proxy: { baseUrl: "https://p/v1", apiKey: "k", api: "anthropic-messages" } });
    // The catalog would name-match `claude-sonnet-4-6` at 1M; the provider says 200k.
    const config = await registerWith({
      data: [
        {
          id: "ag/claude-sonnet-4-6",
          context_length: 200_000,
          max_completion_tokens: 64_000,
          capabilities: { reasoning: true, vision: true },
        },
      ],
    });

    const m = config.models.find((x: any) => x.id === "ag/claude-sonnet-4-6");
    expect(m.contextWindow).toBe(200_000);
    expect(m.metadataSource).toBe("endpoint");
  });

  it("marks a fully-advertised model as metadataSource 'endpoint' (E19)", async () => {
    writeProviders({ proxy: { baseUrl: "https://p/v1", apiKey: "k", api: "anthropic-messages" } });
    const config = await registerWith({
      data: [
        {
          id: "cc/claude-opus-5",
          context_length: 1_000_000,
          max_completion_tokens: 128_000,
          capabilities: { reasoning: true, vision: true },
        },
      ],
    });

    const m = config.models.find((x: any) => x.id === "cc/claude-opus-5");
    expect(m.contextWindow).toBe(1_000_000);
    expect(m.maxTokens).toBe(128_000);
    expect(m.reasoning).toBe(true);
    expect(m.input).toContain("image");
    expect(m.metadataSource).toBe("endpoint");
    // Underdetermined thinking capability → no guessed level table.
    expect(m.thinkingLevelMap).toBeUndefined();
  });

  it("reports the weakest tier when only some fields were advertised (E20)", async () => {
    writeProviders({ proxy: { baseUrl: "https://p/v1", apiKey: "k", api: "anthropic-messages" } });
    const config = await registerWith({ data: [{ id: "unknown-hybrid", capabilities: { reasoning: true } }] });

    const m = config.models.find((x: any) => x.id === "unknown-hybrid");
    expect(m.reasoning).toBe(true); // from the endpoint
    expect(m.contextWindow).toBe(200_000); // from the api-typed floor
    expect(m.metadataSource).toBe("fallback");
  });

  it("still uses the catalog value for a field the provider did not advertise (E22)", async () => {
    writeProviders({ proxy: { baseUrl: "https://p/v1", apiKey: "k", api: "anthropic-messages" } });
    // No context_length; the catalog has `claude-opus-4-7` at 1M.
    const config = await registerWith({ data: [{ id: "cc/claude-opus-4-7", capabilities: { reasoning: true } }] });

    const m = config.models.find((x: any) => x.id === "cc/claude-opus-4-7");
    expect(m.contextWindow).toBe(1_000_000); // catalog tier filled the gap
    expect(m.reasoning).toBe(true);
    expect(m.metadataSource).toBe("catalog");
  });
});
