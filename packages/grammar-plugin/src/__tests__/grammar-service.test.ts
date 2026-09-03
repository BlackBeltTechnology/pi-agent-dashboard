import { describe, expect, it } from "vitest";
import type { GrammarConfig } from "../grammar-config.js";
import { DEFAULT_GRAMMAR } from "../grammar-config.js";
import type { LlmModelRegistry, LlmStreamFn } from "../server/backends/llm.js";
import { checkGrammar } from "../server/grammar-service.js";

function cfg(overrides: Partial<GrammarConfig> = {}): GrammarConfig {
  return {
    ...DEFAULT_GRAMMAR,
    enabled: true,
    ...overrides,
  };
}

const llmCfg = (over: Partial<GrammarConfig> = {}): GrammarConfig =>
  cfg({ llm: { provider: "anthropic", model: "claude-x" }, ...over });

const registry: LlmModelRegistry = {
  find: async (provider, id) => ({ provider, id }),
  getApiKeyAndHeaders: async () => ({ apiKey: "k", headers: {} }),
};

/** streamSimple that yields a fixed JSON body and records the user message. */
function captureStream(json: string): {
  fn: LlmStreamFn;
  captured: { system?: string; messages?: unknown[] };
} {
  const captured: { system?: string; messages?: unknown[] } = {};
  const fn: LlmStreamFn = (opts) => {
    captured.system = opts.system;
    captured.messages = opts.messages;
    return (async function* () {
      yield { type: "done", message: { content: [{ type: "text", text: json }] } };
    })();
  };
  return { fn, captured };
}

describe("checkGrammar", () => {
  it("returns grammar_disabled when the feature is off", async () => {
    const out = await checkGrammar({ text: "hello there", config: cfg({ enabled: false }) });
    expect(out).toEqual({ ok: false, code: "grammar_disabled", message: expect.any(String) });
  });

  it("returns empty_text for whitespace-only input", async () => {
    const out = await checkGrammar({ text: "   ", config: cfg() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("empty_text");
  });

  it("clips oversized text and flags truncated, passing only maxChars to the model", async () => {
    const { fn, captured } = captureStream('{"correctedText":"x","suggestions":[]}');
    const big = "a".repeat(500);
    const out = await checkGrammar({
      text: big,
      config: llmCfg({ maxChars: 100 }),
      registry,
      streamSimple: fn,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.truncated).toBe(true);
    const content = (captured.messages?.[0] as { content?: string })?.content ?? "";
    expect(content).toContain("a".repeat(100));
    expect(content).not.toContain("a".repeat(101));
  });

  it("returns backend_unconfigured with no llm config", async () => {
    const out = await checkGrammar({ text: "hello there", config: cfg() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("backend_unconfigured");
  });

  it("passes the requested language through to the model prompt", async () => {
    const { fn, captured } = captureStream('{"correctedText":"x","suggestions":[]}');
    await checkGrammar({
      text: "hello there",
      language: "hu-HU",
      config: llmCfg(),
      registry,
      streamSimple: fn,
    });
    expect(captured.system).toContain('The text language is "hu-HU"');
  });
});
