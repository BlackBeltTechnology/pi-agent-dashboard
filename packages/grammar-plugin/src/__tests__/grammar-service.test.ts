import type { GrammarConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { DEFAULT_GRAMMAR } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkGrammar } from "../server/grammar-service.js";

function cfg(overrides: Partial<GrammarConfig> = {}): GrammarConfig {
  return {
    ...DEFAULT_GRAMMAR,
    languagetool: { ...DEFAULT_GRAMMAR.languagetool },
    enabled: true,
    ...overrides,
  };
}

describe("checkGrammar", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns grammar_disabled when the feature is off", async () => {
    const out = await checkGrammar({ text: "hello there", config: cfg({ enabled: false }) });
    expect(out).toEqual({ ok: false, code: "grammar_disabled", message: expect.any(String) });
  });

  it("returns empty_text for whitespace-only input", async () => {
    const out = await checkGrammar({ text: "   ", config: cfg() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("empty_text");
  });

  it("clips oversized text and flags truncated", async () => {
    let receivedTextLen = -1;
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      const body = new URLSearchParams(String(init.body));
      receivedTextLen = (body.get("text") ?? "").length;
      return new Response(JSON.stringify({ matches: [] }), { status: 200 });
    }) as any;

    const big = "a".repeat(500);
    const out = await checkGrammar({ text: big, config: cfg({ maxChars: 100 }) });
    expect(receivedTextLen).toBe(100);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.truncated).toBe(true);
  });

  it("maps a LanguageTool network failure to backend_unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    const out = await checkGrammar({ text: "hello there", config: cfg({ backend: "languagetool" }) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("backend_unreachable");
  });

  it("returns backend_unconfigured for the llm backend with no llm config", async () => {
    const out = await checkGrammar({ text: "hello there", config: cfg({ backend: "llm" }) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("backend_unconfigured");
  });

  it("passes the requested language through to the backend", async () => {
    let sentLang = "";
    globalThis.fetch = vi.fn(async (_url: any, init: any) => {
      sentLang = new URLSearchParams(String(init.body)).get("language") ?? "";
      return new Response(JSON.stringify({ matches: [] }), { status: 200 });
    }) as any;
    await checkGrammar({ text: "hello there", language: "hu-HU", config: cfg() });
    expect(sentLang).toBe("hu-HU");
  });
});
