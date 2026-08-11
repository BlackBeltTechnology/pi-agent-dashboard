/**
 * Edge-case coverage for the backend-agnostic grammar service: dispatch across
 * every config combination, truncation boundaries, language precedence
 * (arg > config > "auto"), the `capitalizeFirstWord` toggle reaching BOTH
 * backends, error-code mapping (incl. the whole-text fallback surfacing through
 * the service), and `getGrammarHealth`. Complements `grammar-service.test.ts`.
 * See: grammar LLM "no issues despite a clear error" bugfix + edge-case hardening.
 */
import { describe, expect, it } from "vitest";
import type { GrammarConfig } from "../grammar-config.js";
import { DEFAULT_GRAMMAR } from "../grammar-config.js";
import type { LlmModelRegistry, LlmStreamFn } from "../server/backends/llm.js";
import { checkGrammar, getGrammarHealth } from "../server/grammar-service.js";

function cfg(overrides: Partial<GrammarConfig> = {}): GrammarConfig {
  return {
    ...DEFAULT_GRAMMAR,
    enabled: true,
    ...overrides,
  };
}

const registry: LlmModelRegistry = {
  find: async (provider, id) => ({ provider, id }),
  getApiKeyAndHeaders: async () => ({ apiKey: "k", headers: {} }),
};

/** streamSimple that echoes a fixed JSON body and records the opts. */
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

const llmCfg = (over: Partial<GrammarConfig> = {}) =>
  cfg({ llm: { provider: "anthropic", model: "claude-x" }, ...over });

// ── Gating ───────────────────────────────────────────────────────────────────

describe("checkGrammar — gating", () => {
  it("returns grammar_disabled when disabled", async () => {
    const out = await checkGrammar({ text: "hello there", config: cfg({ enabled: false }) });
    expect(out).toMatchObject({ ok: false, code: "grammar_disabled" });
  });
  it("returns empty_text for whitespace-only variants", async () => {
    for (const text of ["   ", "\t\n", "\u00a0"]) {
      const out = await checkGrammar({ text, config: cfg() });
      expect(out).toMatchObject({ ok: false, code: "empty_text" });
    }
  });
  it("returns empty_text when text is not a string", async () => {
    for (const text of [123, null, undefined, {}]) {
      const out = await checkGrammar({ text: text as never, config: cfg() });
      expect(out).toMatchObject({ ok: false, code: "empty_text" });
    }
  });
});

// ── Backend dispatch ─────────────────────────────────────────────────────────

describe("checkGrammar — llm dispatch", () => {
  it("runs the llm backend and returns its result", async () => {
    const { fn } = captureStream('{"correctedText":"These are apples","suggestions":[{"original":"is","replacement":"are","kind":"grammar"}]}');
    const out = await checkGrammar({
      text: "These is apples",
      config: llmCfg(),
      registry,
      streamSimple: fn,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.backend).toBe("llm");
      expect(out.result.suggestions).toHaveLength(1);
      expect(out.result.truncated).toBe(false);
    }
  });

  it("surfaces the whole-text fallback through the service (regression)", async () => {
    const { fn } = captureStream('{"correctedText":"I went to the store","suggestions":[]}');
    const out = await checkGrammar({
      text: "i goed to the store",
      config: llmCfg(),
      registry,
      streamSimple: fn,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.suggestions).toHaveLength(1);
  });

  it("returns backend_unconfigured when llm config is absent", async () => {
    const out = await checkGrammar({ text: "hello there", config: cfg() });
    expect(out).toMatchObject({ ok: false, code: "backend_unconfigured" });
  });

  it("returns backend_unconfigured when the model runtime is missing", async () => {
    const out = await checkGrammar({ text: "hello there", config: llmCfg(), registry: null });
    expect(out).toMatchObject({ ok: false, code: "backend_unconfigured" });
  });

  it("maps a provider error event to backend_unreachable", async () => {
    const errStream: LlmStreamFn = () =>
      (async function* () {
        yield { type: "error", error: { errorMessage: "429" } };
      })();
    const out = await checkGrammar({
      text: "hello there",
      config: llmCfg(),
      registry,
      streamSimple: errStream,
    });
    expect(out).toMatchObject({ ok: false, code: "backend_unreachable" });
  });

  it("maps a raw (non-typed) registry failure to backend_unreachable", async () => {
    const throwing: LlmModelRegistry = {
      find: async () => {
        throw new Error("kaboom");
      },
      getApiKeyAndHeaders: async () => ({ apiKey: "", headers: {} }),
    };
    const out = await checkGrammar({
      text: "hello there",
      config: llmCfg(),
      registry: throwing,
      streamSimple: captureStream("{}").fn,
    });
    expect(out).toMatchObject({ ok: false, code: "backend_unreachable" });
  });
});

// ── Truncation ───────────────────────────────────────────────────────────────

describe("checkGrammar — truncation", () => {
  it("does not flag text exactly at maxChars", async () => {
    const { fn } = captureStream('{"correctedText":"x","suggestions":[]}');
    const out = await checkGrammar({
      text: "a".repeat(100),
      config: llmCfg({ maxChars: 100 }),
      registry,
      streamSimple: fn,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.truncated).toBe(false);
  });

  it("clips oversized text and flags truncated, passing only maxChars to the model", async () => {
    const { fn, captured } = captureStream('{"correctedText":"x","suggestions":[]}');
    const out = await checkGrammar({
      text: "a".repeat(500),
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
});

// ── Language precedence ──────────────────────────────────────────────────────

describe("checkGrammar — language precedence", () => {
  it("prefers the explicit arg language over the config language", async () => {
    const { fn, captured } = captureStream('{"correctedText":"x","suggestions":[]}');
    await checkGrammar({
      text: "hello there",
      language: "es-ES",
      config: llmCfg({ language: "fr-FR" }),
      registry,
      streamSimple: fn,
    });
    expect(captured.system).toContain('The text language is "es-ES"');
  });

  it("uses the config language when no arg is given", async () => {
    const { fn, captured } = captureStream('{"correctedText":"x","suggestions":[]}');
    await checkGrammar({
      text: "hello there",
      config: llmCfg({ language: "fr-FR" }),
      registry,
      streamSimple: fn,
    });
    expect(captured.system).toContain('The text language is "fr-FR"');
  });

  it("falls back to auto when both are empty", async () => {
    const { fn, captured } = captureStream('{"correctedText":"x","suggestions":[]}');
    await checkGrammar({
      text: "hello there",
      config: llmCfg({ language: "" }),
      registry,
      streamSimple: fn,
    });
    expect(captured.system).not.toContain("The text language is");
  });
});

// ── capitalizeFirstWord reaches both backends ────────────────────────────────

describe("checkGrammar — capitalizeFirstWord passthrough", () => {
  it("reaches the llm backend prompt", async () => {
    const off = captureStream('{"correctedText":"x","suggestions":[]}');
    await checkGrammar({ text: "hello there", config: llmCfg({ capitalizeFirstWord: false }), registry, streamSimple: off.fn });
    expect(off.captured.system).toContain("Do NOT change the capitalization");
    const on = captureStream('{"correctedText":"x","suggestions":[]}');
    await checkGrammar({ text: "hello there", config: llmCfg({ capitalizeFirstWord: true }), registry, streamSimple: on.fn });
    expect(on.captured.system).not.toContain("Do NOT change the capitalization");
  });
});

// ── Health ───────────────────────────────────────────────────────────────────

describe("getGrammarHealth", () => {
  it("mirrors the client-facing config fields", () => {
    const h = getGrammarHealth(
      llmCfg({ autoCheck: false, debounceMs: 900, minChars: 30, language: "en-GB" }),
    );
    expect(h).toMatchObject({
      enabled: true,
      backend: "llm",
      autoCheck: false,
      debounceMs: 900,
      minChars: 30,
      language: "en-GB",
      correctionView: "redline",
    });
  });

  it("mirrors correctionView from config", () => {
    const h = getGrammarHealth(llmCfg({ correctionView: "list" }));
    expect(h.correctionView).toBe("list");
  });

  it("never exposes a languagetool block", () => {
    const h = getGrammarHealth(llmCfg());
    expect((h as unknown as Record<string, unknown>).languagetool).toBeUndefined();
  });
});
