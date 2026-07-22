import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCorrections,
  checkWithLanguageTool,
  classifyIssue,
  type LanguageToolMatch,
  mapMatches,
  summarize,
} from "../server/backends/languagetool.js";

describe("classifyIssue", () => {
  it("maps LanguageTool issue types to coarse kinds", () => {
    expect(classifyIssue("misspelling")).toBe("spelling");
    expect(classifyIssue("grammar")).toBe("grammar");
    expect(classifyIssue("typographical")).toBe("punctuation");
    expect(classifyIssue("whitespace")).toBe("punctuation");
    expect(classifyIssue("style")).toBe("style");
    expect(classifyIssue(undefined)).toBe("style");
  });
});

describe("mapMatches", () => {
  const text = "I has a apple";
  it("maps matches with a replacement into suggestions", () => {
    const matches: LanguageToolMatch[] = [
      {
        offset: 2,
        length: 3,
        shortMessage: "Agreement",
        replacements: [{ value: "have" }],
        rule: { issueType: "grammar" },
      },
    ];
    const [s] = mapMatches(matches, text);
    expect(s.original).toBe("has");
    expect(s.replacement).toBe("have");
    expect(s.kind).toBe("grammar");
    expect(s.offset).toBe(2);
    expect(s.length).toBe(3);
    expect(s.message).toBe("Agreement");
  });

  it("drops matches without a replacement", () => {
    const matches: LanguageToolMatch[] = [{ offset: 0, length: 1, replacements: [] }];
    expect(mapMatches(matches, text)).toHaveLength(0);
  });

  it("drops matches whose replacement equals the original", () => {
    const matches: LanguageToolMatch[] = [
      { offset: 0, length: 1, replacements: [{ value: "I" }] },
    ];
    expect(mapMatches(matches, text)).toHaveLength(0);
  });

  it("drops non-positive-length matches", () => {
    const matches: LanguageToolMatch[] = [{ offset: 0, length: 0, replacements: [{ value: "x" }] }];
    expect(mapMatches(matches, text)).toHaveLength(0);
  });
});

describe("applyCorrections", () => {
  it("applies non-overlapping suggestions right-to-left", () => {
    const text = "I has a apple";
    const suggestions = mapMatches(
      [
        { offset: 2, length: 3, replacements: [{ value: "have" }], rule: { issueType: "grammar" } },
        { offset: 8, length: 5, replacements: [{ value: "an apple" }], rule: { issueType: "grammar" } },
      ],
      text,
    );
    expect(applyCorrections(text, suggestions)).toBe("I have a an apple");
  });

  it("skips overlapping suggestions", () => {
    const text = "abcdef";
    const suggestions = [
      { id: "a", offset: 0, length: 4, original: "abcd", replacement: "X", kind: "grammar" as const, message: "" },
      { id: "b", offset: 2, length: 2, original: "cd", replacement: "Y", kind: "grammar" as const, message: "" },
    ];
    // right-to-left: apply offset 2 first (Y), then offset 0 overlaps → skipped
    expect(applyCorrections(text, suggestions)).toBe("abYef");
  });
});

describe("summarize", () => {
  it("reports no issues on empty", () => {
    expect(summarize([])).toBe("No issues found");
  });
  it("counts by kind in a stable order", () => {
    const s = [
      { id: "1", offset: 0, length: 1, original: "a", replacement: "b", kind: "grammar" as const, message: "" },
      { id: "2", offset: 2, length: 1, original: "c", replacement: "d", kind: "spelling" as const, message: "" },
      { id: "3", offset: 4, length: 1, original: "e", replacement: "f", kind: "spelling" as const, message: "" },
    ];
    expect(summarize(s)).toBe("2 spelling · 1 grammar");
  });
});

describe("checkWithLanguageTool", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("posts to /v2/check and maps the response", async () => {
    const captured: { url?: string; body?: string } = {};
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      captured.url = String(url);
      captured.body = String(init.body);
      return new Response(
        JSON.stringify({
          language: { code: "en-US" },
          matches: [
            { offset: 2, length: 3, replacements: [{ value: "have" }], rule: { issueType: "grammar" }, shortMessage: "Agreement" },
          ],
        }),
        { status: 200 },
      );
    }) as any;

    const result = await checkWithLanguageTool("I has a apple", { url: "http://lt:8081/", language: "auto" });
    expect(captured.url).toBe("http://lt:8081/v2/check");
    expect(captured.body).toContain("text=");
    expect(result.backend).toBe("languagetool");
    expect(result.language).toBe("en-US");
    expect(result.suggestions).toHaveLength(1);
    expect(result.correctedText).toBe("I have a apple");
    expect(result.summary).toBe("1 grammar");
  });

  it("throws on a non-OK HTTP status", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as any;
    await expect(checkWithLanguageTool("hi there", { url: "http://lt:8081", language: "auto" })).rejects.toThrow();
  });
});
