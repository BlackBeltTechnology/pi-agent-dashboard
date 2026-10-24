import { describe, expect, it } from "vitest";
import { decodeMermaidEntities } from "../MermaidBlock.js";

// Each entity is decoded exactly once: a double-encoded entity keeps its second layer.
// See change: triage-codeql-alert-debt (design D3 #169).
describe("decodeMermaidEntities", () => {
  it.each([
    ["--&gt;", "-->"],
    ["a &lt; b", "a < b"],
    ["&amp;quot;x&amp;quot;", "&quot;x&quot;"],
    ["&amp;#39;", "&#39;"],
    ["&amp;amp;", "&amp;"],
    ["&quot;x&#39;", "\"x'"],
  ])("decodes %j to %j", (input, expected) => {
    expect(decodeMermaidEntities(input)).toBe(expected);
  });
});
