import { describe, expect, it } from "vitest";
import { DEFAULT_GRAMMAR, parseGrammarConfig } from "../grammar-config.js";

describe("parseGrammarConfig", () => {
  it("yields the disabled default when the input is absent", () => {
    const g = parseGrammarConfig(undefined);
    expect(g).toEqual(DEFAULT_GRAMMAR);
    expect(g.enabled).toBe(false);
    expect(g.autoCheck).toBe(true);
    expect(g.debounceMs).toBe(1200);
    expect(g.minChars).toBe(12);
    expect(g.maxChars).toBe(4000);
    expect(g.language).toBe("auto");
    expect(g.capitalizeFirstWord).toBe(false);
    expect(g.correctionView).toBe("redline");
    expect(g.llm).toBeUndefined();
    expect((g as unknown as Record<string, unknown>).backend).toBeUndefined();
    expect((g as unknown as Record<string, unknown>).languagetool).toBeUndefined();
  });

  it("returns default when input is not an object", () => {
    expect(parseGrammarConfig("on")).toEqual(DEFAULT_GRAMMAR);
  });

  it("preserves valid explicit values", () => {
    const g = parseGrammarConfig({
      enabled: true,
      autoCheck: false,
      debounceMs: 2000,
      minChars: 20,
      maxChars: 8000,
      language: "hu-HU",
      llm: { provider: "anthropic", model: "claude-haiku-4-5" },
    });
    expect(g.enabled).toBe(true);
    expect(g.autoCheck).toBe(false);
    expect(g.debounceMs).toBe(2000);
    expect(g.minChars).toBe(20);
    expect(g.maxChars).toBe(8000);
    expect(g.language).toBe("hu-HU");
    expect(g.llm).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  it("drops a persisted legacy backend + languagetool block (LLM-only migration)", () => {
    const g = parseGrammarConfig({
      enabled: true,
      backend: "languagetool",
      languagetool: { url: "http://lt.local:8010" },
      llm: { provider: "anthropic", model: "claude-haiku-4-5" },
    });
    expect((g as unknown as Record<string, unknown>).backend).toBeUndefined();
    expect((g as unknown as Record<string, unknown>).languagetool).toBeUndefined();
    expect(g.llm).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(g.enabled).toBe(true);
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

  it("defaults correctionView to redline and preserves a valid value", () => {
    expect(parseGrammarConfig(undefined).correctionView).toBe("redline");
    expect(parseGrammarConfig({}).correctionView).toBe("redline");
    expect(parseGrammarConfig({ correctionView: "list" }).correctionView).toBe("list");
    expect(parseGrammarConfig({ correctionView: "redline" }).correctionView).toBe("redline");
  });

  it("clamps an invalid correctionView to redline", () => {
    expect(parseGrammarConfig({ correctionView: "fancy" }).correctionView).toBe("redline");
    expect(parseGrammarConfig({ correctionView: 42 }).correctionView).toBe("redline");
    expect(parseGrammarConfig({ correctionView: null }).correctionView).toBe("redline");
  });

  it("round-trips: parse → parse yields a stable result", () => {
    const first = parseGrammarConfig({ enabled: true, debounceMs: 1500 });
    const second = parseGrammarConfig(first);
    expect(second).toEqual(first);
    expect(second.enabled).toBe(true);
    expect(second.debounceMs).toBe(1500);
  });
});
