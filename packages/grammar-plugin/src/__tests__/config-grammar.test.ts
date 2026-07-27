import { describe, expect, it } from "vitest";
import { DEFAULT_GRAMMAR, parseGrammarConfig } from "../grammar-config.js";

describe("parseGrammarConfig", () => {
  it("yields the disabled default when the input is absent", () => {
    const g = parseGrammarConfig(undefined);
    expect(g).toEqual(DEFAULT_GRAMMAR);
    expect(g.enabled).toBe(false);
    expect(g.backend).toBe("languagetool");
    expect(g.autoCheck).toBe(true);
    expect(g.debounceMs).toBe(1200);
    expect(g.minChars).toBe(12);
    expect(g.maxChars).toBe(4000);
    expect(g.language).toBe("auto");
    expect(g.capitalizeFirstWord).toBe(false);
    expect(g.languagetool.url).toBe("http://localhost:8081");
    expect(g.llm).toBeUndefined();
  });

  it("returns default when input is not an object", () => {
    expect(parseGrammarConfig("on")).toEqual(DEFAULT_GRAMMAR);
  });

  it("preserves valid explicit values", () => {
    const g = parseGrammarConfig({
      enabled: true,
      backend: "llm",
      autoCheck: false,
      debounceMs: 2000,
      minChars: 20,
      maxChars: 8000,
      language: "hu-HU",
      languagetool: { url: "http://lt.local:8010" },
      llm: { provider: "anthropic", model: "claude-haiku-4-5" },
    });
    expect(g.enabled).toBe(true);
    expect(g.backend).toBe("llm");
    expect(g.autoCheck).toBe(false);
    expect(g.debounceMs).toBe(2000);
    expect(g.minChars).toBe(20);
    expect(g.maxChars).toBe(8000);
    expect(g.language).toBe("hu-HU");
    expect(g.languagetool.url).toBe("http://lt.local:8010");
    expect(g.llm).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("clamps out-of-range numerics", () => {
    const g = parseGrammarConfig({ debounceMs: 50, minChars: 9999, maxChars: 999999 });
    expect(g.debounceMs).toBe(300);
    expect(g.minChars).toBe(500);
    expect(g.maxChars).toBe(20000);
  });

  it("clamps low maxChars up to the floor", () => {
    expect(parseGrammarConfig({ maxChars: 1 }).maxChars).toBe(100);
  });

  it("falls back to languagetool on an invalid backend", () => {
    expect(parseGrammarConfig({ backend: "wizard" }).backend).toBe("languagetool");
  });

  it("ignores a malformed llm block", () => {
    expect(parseGrammarConfig({ llm: { provider: "anthropic" } }).llm).toBeUndefined();
  });

  it("ignores unknown keys", () => {
    const g = parseGrammarConfig({ enabled: true, nonsense: 42 });
    expect(g.enabled).toBe(true);
    expect((g as unknown as Record<string, unknown>).nonsense).toBeUndefined();
  });

  it("parses capitalizeFirstWord and ignores non-boolean values", () => {
    expect(parseGrammarConfig({ capitalizeFirstWord: true }).capitalizeFirstWord).toBe(true);
    expect(parseGrammarConfig({ capitalizeFirstWord: "yes" }).capitalizeFirstWord).toBe(false);
  });

  it("defaults languagetool.url when blank", () => {
    expect(parseGrammarConfig({ languagetool: { url: "  " } }).languagetool.url).toBe(
      "http://localhost:8081",
    );
  });

  it("round-trips: parse → parse yields a stable result", () => {
    const first = parseGrammarConfig({ enabled: true, backend: "llm", debounceMs: 1500 });
    const second = parseGrammarConfig(first);
    expect(second).toEqual(first);
    expect(second.enabled).toBe(true);
    expect(second.backend).toBe("llm");
    expect(second.debounceMs).toBe(1500);
  });
});
