/**
 * JSONC parsing parity with pi core.
 *
 * pi's own `models.json` loader does `JSON.parse(stripJsonComments(content))`
 * (pi-coding-agent/dist/core/model-config.js), so a commented file is VALID
 * input as far as pi is concerned. The dashboard must accept exactly the same
 * shape or it rejects a file pi happily reads.
 *
 * See change: honor-native-models-json-metadata (JSONC parity fix).
 */
import { describe, it, expect } from "vitest";
import { parseJsonc, stripJsonComments } from "../jsonc.js";

describe("stripJsonComments", () => {
  it("removes a leading line comment", () => {
    expect(JSON.parse(stripJsonComments('{\n  // hi\n  "a": 1\n}'))).toEqual({ a: 1 });
  });

  it("removes a trailing line comment after a value", () => {
    expect(JSON.parse(stripJsonComments('{ "a": 1 // note\n }'))).toEqual({ a: 1 });
  });

  it("removes block comments, including multi-line", () => {
    expect(JSON.parse(stripJsonComments('{ /* x\n y */ "a": 1 }'))).toEqual({ a: 1 });
  });

  it("keeps comment-like sequences INSIDE strings", () => {
    const src = '{ "url": "https://example.com/a//b", "note": "/* not a comment */" }';
    expect(JSON.parse(stripJsonComments(src))).toEqual({
      url: "https://example.com/a//b",
      note: "/* not a comment */",
    });
  });

  it("respects escaped quotes when tracking string state", () => {
    const src = '{ "q": "he said \\"hi\\" // still string" }';
    expect(JSON.parse(stripJsonComments(src))).toEqual({ q: 'he said "hi" // still string' });
  });

  it("preserves newlines so parse-error line numbers stay meaningful", () => {
    const stripped = stripJsonComments('{\n// a\n// b\n"a": 1\n}');
    expect(stripped.split("\n")).toHaveLength(5);
  });

  it("leaves comment-free input byte-identical", () => {
    const src = '{"a":1,"b":[2,3]}';
    expect(stripJsonComments(src)).toBe(src);
  });
});

describe("parseJsonc", () => {
  it("parses the real-world commented models.json shape", () => {
    const src = `{
  // Custom model registrations for pi-coding-agent.
  "providers": {
    "anthropic": {
      "models": [
        {
          "id": "claude-fable-5",
          // Pricing per the announcement.
          "cost": { "input": 10, "output": 50 }
        }
      ]
    }
  }
}`;
    const parsed = parseJsonc(src) as any;
    expect(parsed.providers.anthropic.models[0].id).toBe("claude-fable-5");
    expect(parsed.providers.anthropic.models[0].cost.input).toBe(10);
  });

  it("still throws on genuinely malformed JSON so callers can warn", () => {
    expect(() => parseJsonc('{ "a": }')).toThrow();
  });
});
