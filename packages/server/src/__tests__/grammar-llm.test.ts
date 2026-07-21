import { describe, expect, it } from "vitest";
import { extractJsonObject, parseLlmResult } from "../grammar/backends/llm.js";
import { GrammarBackendError } from "../grammar/grammar-errors.js";

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses a fenced ```json block", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("parses JSON embedded in prose", () => {
    expect(extractJsonObject('Here you go: {"a":1} done')).toEqual({ a: 1 });
  });
  it("throws backend_bad_response when there is no object", () => {
    try {
      extractJsonObject("no json here");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GrammarBackendError);
      expect((e as GrammarBackendError).code).toBe("backend_bad_response");
    }
  });
  it("throws backend_bad_response on malformed JSON", () => {
    expect(() => extractJsonObject("{ not valid }")).toThrow(GrammarBackendError);
  });
});

describe("parseLlmResult", () => {
  const text = "I has a apple";

  it("relocates offsets from `original`, ignoring model-supplied offsets", () => {
    const raw = {
      correctedText: "I have an apple",
      suggestions: [
        { original: "has", replacement: "have", kind: "grammar", message: "Agreement" },
        { original: "a apple", replacement: "an apple", kind: "grammar", message: "Article" },
      ],
      summary: "2 grammar",
    };
    const result = parseLlmResult(raw, text, "en-US");
    expect(result.backend).toBe("llm");
    expect(result.correctedText).toBe("I have an apple");
    expect(result.suggestions[0]).toMatchObject({ offset: 2, length: 3, original: "has" });
    expect(result.suggestions[1]).toMatchObject({ offset: 6, length: 7, original: "a apple" });
    expect(result.summary).toBe("2 grammar");
  });

  it("drops suggestions whose `original` is not in the text", () => {
    const raw = {
      correctedText: text,
      suggestions: [{ original: "zzz", replacement: "qqq", kind: "spelling" }],
    };
    expect(parseLlmResult(raw, text, "en-US").suggestions).toHaveLength(0);
  });

  it("drops suggestions where replacement equals original", () => {
    const raw = { suggestions: [{ original: "has", replacement: "has", kind: "grammar" }] };
    expect(parseLlmResult(raw, text, "en-US").suggestions).toHaveLength(0);
  });

  it("defaults an invalid kind to grammar", () => {
    const raw = { suggestions: [{ original: "has", replacement: "have", kind: "wizardry" }] };
    expect(parseLlmResult(raw, text, "en-US").suggestions[0].kind).toBe("grammar");
  });

  it("falls back to computed summary when the model omits one", () => {
    const raw = { suggestions: [{ original: "has", replacement: "have", kind: "grammar" }] };
    expect(parseLlmResult(raw, text, "en-US").summary).toBe("1 grammar");
  });

  it("falls back to the input as correctedText when the model omits it", () => {
    expect(parseLlmResult({ suggestions: [] }, text, "en-US").correctedText).toBe(text);
  });

  it("throws backend_bad_response when the payload is not an object", () => {
    expect(() => parseLlmResult(null, text, "en-US")).toThrow(GrammarBackendError);
  });
});
