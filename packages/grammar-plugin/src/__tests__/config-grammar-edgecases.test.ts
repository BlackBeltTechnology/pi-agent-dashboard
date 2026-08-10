/**
 * Exhaustive config matrix for `parseGrammarConfig` — every field, every clamp
 * boundary, type-coercion fallbacks, the `llm` sub-block validation, url
 * handling, and defensive-copy semantics. Complements `config-grammar.test.ts`.
 * "All configuration should be tested to work." See: grammar LLM
 * "no issues despite a clear error" bugfix + edge-case hardening.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_GRAMMAR, parseGrammarConfig } from "../grammar-config.js";

describe("parseGrammarConfig — boolean fields coerce safely", () => {
  it("defaults enabled/autoCheck/capitalizeFirstWord on non-boolean input", () => {
    const g = parseGrammarConfig({
      enabled: "true",
      autoCheck: 1,
      capitalizeFirstWord: "yes",
    });
    expect(g.enabled).toBe(false);
    expect(g.autoCheck).toBe(true);
    expect(g.capitalizeFirstWord).toBe(false);
  });
  it("honours explicit false for autoCheck", () => {
    expect(parseGrammarConfig({ autoCheck: false }).autoCheck).toBe(false);
  });
  it("honours explicit true for enabled and capitalizeFirstWord", () => {
    const g = parseGrammarConfig({ enabled: true, capitalizeFirstWord: true });
    expect(g.enabled).toBe(true);
    expect(g.capitalizeFirstWord).toBe(true);
  });
});

describe("parseGrammarConfig — numeric clamping boundaries", () => {
  it("keeps values exactly at each boundary", () => {
    const lo = parseGrammarConfig({ debounceMs: 300, minChars: 1, maxChars: 100 });
    expect([lo.debounceMs, lo.minChars, lo.maxChars]).toEqual([300, 1, 100]);
    const hi = parseGrammarConfig({ debounceMs: 10000, minChars: 500, maxChars: 20000 });
    expect([hi.debounceMs, hi.minChars, hi.maxChars]).toEqual([10000, 500, 20000]);
  });
  it("clamps just-below and just-above the boundary", () => {
    const below = parseGrammarConfig({ debounceMs: 299, minChars: 0, maxChars: 99 });
    expect([below.debounceMs, below.minChars, below.maxChars]).toEqual([300, 1, 100]);
    const above = parseGrammarConfig({ debounceMs: 10001, minChars: 501, maxChars: 20001 });
    expect([above.debounceMs, above.minChars, above.maxChars]).toEqual([10000, 500, 20000]);
  });
  it("falls back to defaults for NaN / Infinity / non-number", () => {
    const g = parseGrammarConfig({
      debounceMs: Number.NaN,
      minChars: Number.POSITIVE_INFINITY,
      maxChars: "8000",
    });
    expect(g.debounceMs).toBe(DEFAULT_GRAMMAR.debounceMs);
    expect(g.minChars).toBe(DEFAULT_GRAMMAR.minChars);
    expect(g.maxChars).toBe(DEFAULT_GRAMMAR.maxChars);
  });
  it("clamps a negative debounce up to the floor", () => {
    expect(parseGrammarConfig({ debounceMs: -5000 }).debounceMs).toBe(300);
  });
});

describe("parseGrammarConfig — backend selection", () => {
  it("accepts the two valid backends", () => {
    expect(parseGrammarConfig({ backend: "llm" }).backend).toBe("llm");
    expect(parseGrammarConfig({ backend: "languagetool" }).backend).toBe("languagetool");
  });
  it("rejects wrong-case and unknown backends", () => {
    expect(parseGrammarConfig({ backend: "LLM" }).backend).toBe("languagetool");
    expect(parseGrammarConfig({ backend: "wizard" }).backend).toBe("languagetool");
    expect(parseGrammarConfig({ backend: null }).backend).toBe("languagetool");
    expect(parseGrammarConfig({ backend: 3 }).backend).toBe("languagetool");
  });
});

describe("parseGrammarConfig — language", () => {
  it("keeps a real language code", () => {
    expect(parseGrammarConfig({ language: "hu-HU" }).language).toBe("hu-HU");
  });
  it("defaults blank / whitespace / non-string to auto", () => {
    expect(parseGrammarConfig({ language: "   " }).language).toBe("auto");
    expect(parseGrammarConfig({ language: "" }).language).toBe("auto");
    expect(parseGrammarConfig({ language: 42 }).language).toBe("auto");
  });
});

describe("parseGrammarConfig — languagetool url", () => {
  it("keeps a non-blank url", () => {
    expect(parseGrammarConfig({ languagetool: { url: "http://lt:9000" } }).languagetool.url).toBe(
      "http://lt:9000",
    );
  });
  it("defaults a blank url", () => {
    expect(parseGrammarConfig({ languagetool: { url: "   " } }).languagetool.url).toBe(
      DEFAULT_GRAMMAR.languagetool.url,
    );
  });
  it("defaults when languagetool is not an object or url is missing", () => {
    expect(parseGrammarConfig({ languagetool: "nope" }).languagetool.url).toBe(
      DEFAULT_GRAMMAR.languagetool.url,
    );
    expect(parseGrammarConfig({ languagetool: {} }).languagetool.url).toBe(
      DEFAULT_GRAMMAR.languagetool.url,
    );
    expect(parseGrammarConfig({ languagetool: { url: 123 } }).languagetool.url).toBe(
      DEFAULT_GRAMMAR.languagetool.url,
    );
  });
});

describe("parseGrammarConfig — llm sub-block", () => {
  it("accepts a complete llm block", () => {
    expect(parseGrammarConfig({ llm: { provider: "openai", model: "gpt-x" } }).llm).toEqual({
      provider: "openai",
      model: "gpt-x",
    });
  });
  it("strips extra keys, keeping only provider/model", () => {
    const g = parseGrammarConfig({
      llm: { provider: "openai", model: "gpt-x", apiKey: "leak", temperature: 0.9 },
    });
    expect(g.llm).toEqual({ provider: "openai", model: "gpt-x" });
  });
  it("drops a partial or empty-string llm block", () => {
    expect(parseGrammarConfig({ llm: { provider: "openai" } }).llm).toBeUndefined();
    expect(parseGrammarConfig({ llm: { model: "gpt-x" } }).llm).toBeUndefined();
    expect(parseGrammarConfig({ llm: { provider: "", model: "gpt-x" } }).llm).toBeUndefined();
    expect(parseGrammarConfig({ llm: { provider: "openai", model: "" } }).llm).toBeUndefined();
  });
  it("drops a non-object llm block", () => {
    expect(parseGrammarConfig({ llm: "x" }).llm).toBeUndefined();
    expect(parseGrammarConfig({ llm: null }).llm).toBeUndefined();
    expect(parseGrammarConfig({ llm: 42 }).llm).toBeUndefined();
  });
  it("drops an llm block whose provider/model are the wrong type", () => {
    expect(parseGrammarConfig({ llm: { provider: 1, model: 2 } }).llm).toBeUndefined();
  });
});

describe("parseGrammarConfig — structural safety", () => {
  it("returns a fresh languagetool object (not the shared default reference)", () => {
    const g = parseGrammarConfig({});
    expect(g.languagetool).not.toBe(DEFAULT_GRAMMAR.languagetool);
    g.languagetool.url = "mutated";
    expect(DEFAULT_GRAMMAR.languagetool.url).toBe("http://localhost:8081");
  });
  it("never leaks unknown top-level keys onto the result", () => {
    const g = parseGrammarConfig({ enabled: true, secret: "x", nonsense: 42 });
    expect((g as unknown as Record<string, unknown>).secret).toBeUndefined();
    expect((g as unknown as Record<string, unknown>).nonsense).toBeUndefined();
  });
  it("does not honour a JSON-injected __proto__ own-key", () => {
    const g = parseGrammarConfig(JSON.parse('{"enabled":true,"__proto__":{"polluted":true}}'));
    expect(g.enabled).toBe(true);
    expect((g as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("is idempotent across a full valid config", () => {
    const full = parseGrammarConfig({
      enabled: true,
      backend: "llm",
      autoCheck: false,
      debounceMs: 1500,
      minChars: 25,
      maxChars: 12000,
      language: "en-GB",
      capitalizeFirstWord: true,
      languagetool: { url: "http://lt:8100" },
      llm: { provider: "anthropic", model: "claude-haiku" },
    });
    expect(parseGrammarConfig(full)).toEqual(full);
  });
});
