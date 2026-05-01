/**
 * Unit tests for `encodePromptAnswer` — the pure helper that translates
 * interactive renderer `result` payloads into the `answer` string field
 * of a PromptBus `prompt_response`.
 *
 * The multiselect path was previously broken because the encoder did not
 * recognize the `{ values: string[] }` shape, falling through to
 * `String(undefined ?? "")` and emitting `answer: ""` — indistinguishable
 * from "user submitted with nothing checked", which itself is a valid
 * answer that must remain distinguishable from cancellation.
 *
 * See change: fix-multiselect-auto-cancel-on-dashboard.
 */
import { describe, it, expect } from "vitest";
import { encodePromptAnswer } from "../lib/prompt-answer-encoder.js";

describe("encodePromptAnswer", () => {
  // ── multiselect arm ────────────────────────────────────────────────
  it("encodes multiselect values as JSON-stringified array", () => {
    expect(encodePromptAnswer({ values: ["a", "b"] }, false)).toBe('["a","b"]');
  });

  it("encodes empty multiselect selection as '[]' (NOT '' or undefined)", () => {
    expect(encodePromptAnswer({ values: [] }, false)).toBe("[]");
  });

  it("encodes cancellation as undefined regardless of result shape", () => {
    expect(encodePromptAnswer({ values: ["a"] }, true)).toBeUndefined();
    expect(encodePromptAnswer({ value: "X" }, true)).toBeUndefined();
    expect(encodePromptAnswer(undefined, true)).toBeUndefined();
  });

  // ── select / input / editor (regression guards) ────────────────────
  it("encodes select result.value as the raw string", () => {
    expect(encodePromptAnswer({ value: "X" }, false)).toBe("X");
  });

  it("encodes input result.value as the raw string", () => {
    expect(encodePromptAnswer({ value: "hello world" }, false)).toBe("hello world");
  });

  it("encodes editor result.value as the raw string (multi-line)", () => {
    expect(encodePromptAnswer({ value: "line1\nline2" }, false)).toBe("line1\nline2");
  });

  // ── confirm arm (regression guard) ─────────────────────────────────
  it("encodes confirm result.confirmed as 'true' / 'false'", () => {
    expect(encodePromptAnswer({ confirmed: true }, false)).toBe("true");
    expect(encodePromptAnswer({ confirmed: false }, false)).toBe("false");
  });

  // ── precedence ─────────────────────────────────────────────────────
  it("multiselect (values) takes precedence over value", () => {
    // Defensive: if a renderer ever returned both, the array wins so we
    // don't accidentally collapse the array via String([...]).
    expect(encodePromptAnswer({ values: ["a"], value: "X" }, false)).toBe('["a"]');
  });

  it("value takes precedence over confirmed", () => {
    expect(encodePromptAnswer({ value: "X", confirmed: true }, false)).toBe("X");
  });

  // ── fallback ───────────────────────────────────────────────────────
  it("encodes a bare string result as itself", () => {
    expect(encodePromptAnswer("plain", false)).toBe("plain");
  });

  it("encodes null/undefined non-cancelled result as empty string", () => {
    expect(encodePromptAnswer(undefined, false)).toBe("");
    expect(encodePromptAnswer(null, false)).toBe("");
  });
});
