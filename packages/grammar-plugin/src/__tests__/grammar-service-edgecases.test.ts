/**
 * Edge-case coverage for the backend-agnostic grammar service: dispatch across
 * every config combination, truncation boundaries, language precedence
 * (arg > config > "auto"), the `capitalizeFirstWord` toggle reaching BOTH
 * backends, error-code mapping (incl. the whole-text fallback surfacing through
 * the service), and `getGrammarHealth`. Complements `grammar-service.test.ts`.
 * See: grammar LLM "no issues despite a clear error" bugfix + edge-case hardening.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrammarConfig } from "../grammar-config.js";
import { DEFAULT_GRAMMAR } from "../grammar-config.js";
import type { LlmModelRegistry, LlmStreamFn } from "../server/backends/llm.js";
import { checkGrammar, getGrammarHealth } from "../server/grammar-service.js";

function cfg(overrides: Partial<GrammarConfig> = {}): GrammarConfig {
  return {
    ...DEFAULT_GRAMMAR,
    languagetool: { ...DEFAULT_GRAMMAR.languagetool },
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
  cfg({ backend: "llm", llm: { provider: "anthropic", model: "claude-x" }, ...over });

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
    const out = await checkGrammar({ text: "hello there", config: cfg({ backend: "llm" }) });
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

describe("checkGrammar — languagetool dispatch", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps a non-OK HTTP status to backend_unreachable", async () => {
    globalThis.fetch = vi.fn(async () => new Response("bad", { status: 503 })) as never;
    const out = await checkGrammar({ text: "hello there", config: cfg() });
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

  it("reaches the languagetool request body", async () => {
    const orig = globalThis.fetch;
    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (_url: unknown, init: { body?: unknown }) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ matches: [] }), { status: 200 });
    }) as never;
    try {
      await checkGrammar({ text: "hello there", config: cfg({ capitalizeFirstWord: false }) });
      await checkGrammar({ text: "hello there", config: cfg({ capitalizeFirstWord: true }) });
      expect(bodies[0]).toContain("disabledRules=UPPERCASE_SENTENCE_START");
      expect(bodies[1]).not.toContain("disabledRules");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ── Health ───────────────────────────────────────────────────────────────────

describe("getGrammarHealth", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("mirrors the client-facing config fields", async () => {
    const h = await getGrammarHealth(
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

  it("mirrors correctionView from config", async () => {
    const h = await getGrammarHealth(llmCfg({ correctionView: "list" }));
    expect(h.correctionView).toBe("list");
  });

  it("omits the languagetool probe for the llm backend", async () => {
    const probe = vi.fn();
    globalThis.fetch = probe as never;
    const h = await getGrammarHealth(llmCfg());
    expect(h.languagetool).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports reachable:true when the LT probe succeeds", async () => {
    globalThis.fetch = vi.fn(async () => new Response("[]", { status: 200 })) as never;
    const h = await getGrammarHealth(cfg({ backend: "languagetool" }));
    expect(h.languagetool).toEqual({ url: "http://localhost:8081", reachable: true });
  });

  it("reports reachable:false on a non-OK probe", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as never;
    const h = await getGrammarHealth(cfg({ backend: "languagetool" }));
    expect(h.languagetool?.reachable).toBe(false);
  });

  it("reports reachable:false when the probe throws", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as never;
    const h = await getGrammarHealth(cfg({ backend: "languagetool" }));
    expect(h.languagetool?.reachable).toBe(false);
  });
});
