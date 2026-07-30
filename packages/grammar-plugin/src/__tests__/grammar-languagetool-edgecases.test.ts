/**
 * Edge-case coverage for the LanguageTool backend helpers + IO: multi-replacement
 * matches, missing rules, out-of-bounds/adjacent corrections, unicode offsets,
 * summary ordering across all four kinds, url normalization, and language
 * fallback. Complements `grammar-languagetool.test.ts`. See: grammar LLM
 * "no issues despite a clear error" bugfix + edge-case hardening.
 */

import type { GrammarSuggestion } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCorrections,
  checkWithLanguageTool,
  classifyIssue,
  mapMatches,
  summarize,
} from "../server/backends/languagetool.js";

const sug = (o: Partial<GrammarSuggestion>): GrammarSuggestion => ({
  id: "x",
  offset: 0,
  length: 1,
  original: "a",
  replacement: "b",
  kind: "grammar",
  message: "",
  ...o,
});

describe("classifyIssue — full mapping", () => {
  it("maps known issue types and defaults the rest to style", () => {
    expect(classifyIssue("misspelling")).toBe("spelling");
    expect(classifyIssue("grammar")).toBe("grammar");
    expect(classifyIssue("typographical")).toBe("punctuation");
    expect(classifyIssue("whitespace")).toBe("punctuation");
    expect(classifyIssue("uncategorized")).toBe("style");
    expect(classifyIssue(undefined)).toBe("style");
  });
});

describe("mapMatches — edge cases", () => {
  const text = "I has a apple";
  it("uses the first replacement when several are offered", () => {
    const [s] = mapMatches(
      [{ offset: 2, length: 3, replacements: [{ value: "have" }, { value: "had" }] }],
      text,
    );
    expect(s.replacement).toBe("have");
  });
  it("classifies a match with no rule as style", () => {
    const [s] = mapMatches([{ offset: 2, length: 3, replacements: [{ value: "have" }] }], text);
    expect(s.kind).toBe("style");
  });
  it("prefers shortMessage, then message, then a default", () => {
    const [short] = mapMatches(
      [{ offset: 2, length: 3, replacements: [{ value: "have" }], shortMessage: "S", message: "L" }],
      text,
    );
    expect(short.message).toBe("S");
    const [long] = mapMatches(
      [{ offset: 2, length: 3, replacements: [{ value: "have" }], message: "L" }],
      text,
    );
    expect(long.message).toBe("L");
    const [def] = mapMatches([{ offset: 2, length: 3, replacements: [{ value: "have" }] }], text);
    expect(def.message).toBe("Suggested correction");
  });
  it("drops matches with a non-string replacement value", () => {
    expect(
      mapMatches([{ offset: 0, length: 1, replacements: [{ value: undefined }] }], text),
    ).toHaveLength(0);
  });
  it("drops matches with non-numeric offset/length", () => {
    expect(
      mapMatches(
        [{ offset: "2" as never, length: 3, replacements: [{ value: "x" }] }],
        text,
      ),
    ).toHaveLength(0);
  });
  it("indexes correctly into unicode text (offsets are UTF-16 code units)", () => {
    const emoji = "😀 teh cat"; // 😀 is 2 UTF-16 units, so "teh" starts at offset 3
    const [s] = mapMatches([{ offset: 3, length: 3, replacements: [{ value: "the" }] }], emoji);
    expect(s.original).toBe("teh");
    expect(s.replacement).toBe("the");
  });
});

describe("applyCorrections — edge cases", () => {
  it("applies adjacent (touching, non-overlapping) corrections", () => {
    const out = applyCorrections("abcd", [
      sug({ offset: 0, length: 2, original: "ab", replacement: "X" }),
      sug({ offset: 2, length: 2, original: "cd", replacement: "Y" }),
    ]);
    expect(out).toBe("XY");
  });
  it("skips a correction whose span runs past the end of text", () => {
    const out = applyCorrections("abc", [
      sug({ offset: 1, length: 10, original: "bc", replacement: "Z" }),
    ]);
    expect(out).toBe("abc");
  });
  it("skips a correction with a negative offset", () => {
    const out = applyCorrections("abc", [
      sug({ offset: -1, length: 2, original: "ab", replacement: "Z" }),
    ]);
    expect(out).toBe("abc");
  });
  it("returns the text unchanged for an empty suggestion list", () => {
    expect(applyCorrections("abc", [])).toBe("abc");
  });
  it("applies multiple non-overlapping corrections right-to-left", () => {
    const out = applyCorrections("one two three", [
      sug({ offset: 0, length: 3, original: "one", replacement: "1" }),
      sug({ offset: 8, length: 5, original: "three", replacement: "3" }),
    ]);
    expect(out).toBe("1 two 3");
  });
});

describe("summarize — ordering", () => {
  it("orders kinds spelling · grammar · punctuation · style", () => {
    const out = summarize([
      sug({ kind: "style" }),
      sug({ kind: "punctuation" }),
      sug({ kind: "grammar" }),
      sug({ kind: "spelling" }),
      sug({ kind: "spelling" }),
    ]);
    expect(out).toBe("2 spelling · 1 grammar · 1 punctuation · 1 style");
  });
  it("reports 'No issues found' for an empty list", () => {
    expect(summarize([])).toBe("No issues found");
  });
});

describe("checkWithLanguageTool — IO edge cases", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("strips multiple trailing slashes from the base url", async () => {
    let calledUrl = "";
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ matches: [] }), { status: 200 });
    }) as never;
    await checkWithLanguageTool("hello there", { url: "http://lt:8081///", language: "auto" });
    expect(calledUrl).toBe("http://lt:8081/v2/check");
  });

  it("returns no-issue result on empty matches", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ matches: [] }), { status: 200 })) as never;
    const r = await checkWithLanguageTool("all good here", { url: "http://lt:8081", language: "auto" });
    expect(r.suggestions).toHaveLength(0);
    expect(r.correctedText).toBe("all good here");
    expect(r.summary).toBe("No issues found");
  });

  it("uses the response language code, else the requested language, else auto", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ matches: [], language: { code: "en-US" } }), { status: 200 }),
    ) as never;
    const withCode = await checkWithLanguageTool("hi", { url: "http://lt:8081", language: "de" });
    expect(withCode.language).toBe("en-US");

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ matches: [] }), { status: 200 })) as never;
    const fromArg = await checkWithLanguageTool("hi", { url: "http://lt:8081", language: "de" });
    expect(fromArg.language).toBe("de");

    const fromAuto = await checkWithLanguageTool("hi", { url: "http://lt:8081", language: "" });
    expect(fromAuto.language).toBe("auto");
  });

  it("sends the requested language in the form body", async () => {
    let body = "";
    globalThis.fetch = vi.fn(async (_url: unknown, init: { body?: unknown }) => {
      body = String(init.body);
      return new Response(JSON.stringify({ matches: [] }), { status: 200 });
    }) as never;
    await checkWithLanguageTool("hello there", { url: "http://lt:8081", language: "hu-HU" });
    expect(new URLSearchParams(body).get("language")).toBe("hu-HU");
  });

  it("throws on a non-OK HTTP status", async () => {
    globalThis.fetch = vi.fn(async () => new Response("no", { status: 500 })) as never;
    await expect(
      checkWithLanguageTool("hi there", { url: "http://lt:8081", language: "auto" }),
    ).rejects.toThrow();
  });
});
