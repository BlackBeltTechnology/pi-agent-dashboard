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
import { encodePromptAnswer, validateQuestionAnswer } from "../prompt-answer.js";

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

// ── validateQuestionAnswer (test-plan E6, shared part) ───────────────
describe("validateQuestionAnswer", () => {
  const ok = { ok: true };

  it("confirm accepts only 'true'/'false'", () => {
    expect(validateQuestionAnswer({ type: "confirm" }, "true")).toEqual(ok);
    expect(validateQuestionAnswer({ type: "confirm" }, "false")).toEqual(ok);
    expect(validateQuestionAnswer({ type: "confirm" }, "yes").ok).toBe(false);
    expect(validateQuestionAnswer({ type: "confirm" }, "").ok).toBe(false);
  });

  it("select requires one of the options", () => {
    const p = { type: "select", options: ["a", "b"] };
    expect(validateQuestionAnswer(p, "a")).toEqual(ok);
    expect(validateQuestionAnswer(p, "c").ok).toBe(false);
    expect(validateQuestionAnswer({ type: "select" }, "a").ok).toBe(false);
  });

  it("multiselect requires a JSON array of distinct options; [] allowed", () => {
    const p = { type: "multiselect", options: ["a", "b"] };
    expect(validateQuestionAnswer(p, '["a","b"]')).toEqual(ok);
    expect(validateQuestionAnswer(p, "[]")).toEqual(ok);
    expect(validateQuestionAnswer(p, '["a","a"]').ok).toBe(false);
    expect(validateQuestionAnswer(p, '["z"]').ok).toBe(false);
    expect(validateQuestionAnswer(p, "a").ok).toBe(false);
    expect(validateQuestionAnswer(p, '"a"').ok).toBe(false);
    expect(validateQuestionAnswer(p, "[1]").ok).toBe(false);
  });

  it("input and editor accept any string including empty", () => {
    for (const type of ["input", "editor"]) {
      expect(validateQuestionAnswer({ type }, "")).toEqual(ok);
      expect(validateQuestionAnswer({ type }, "x\ny")).toEqual(ok);
    }
  });

  describe("batch", () => {
    const questions = [
      { method: "confirm", title: "c" },
      { method: "select", title: "s", options: ["a", "b"] },
      { method: "multiselect", title: "m", options: ["x", "y"] },
      { method: "input", title: "i" },
    ];
    const p = { type: "batch", metadata: { questions } };
    const good = [{ confirmed: true }, { value: "a" }, { values: ["x"] }, { value: "" }];

    it("accepts one valid entry per sub-question", () => {
      expect(validateQuestionAnswer(p, JSON.stringify(good))).toEqual(ok);
    });
    it("rejects wrong length", () => {
      expect(validateQuestionAnswer(p, JSON.stringify(good.slice(1))).ok).toBe(false);
    });
    it("rejects wrong sub-type per entry", () => {
      const bad = [{ value: "true" }, ...good.slice(1)];
      expect(validateQuestionAnswer(p, JSON.stringify(bad)).ok).toBe(false);
      const badSelect = [good[0], { value: "zzz" }, good[2], good[3]];
      expect(validateQuestionAnswer(p, JSON.stringify(badSelect)).ok).toBe(false);
      const dup = [good[0], good[1], { values: ["x", "x"] }, good[3]];
      expect(validateQuestionAnswer(p, JSON.stringify(dup)).ok).toBe(false);
    });
    it("rejects images (text-only road), non-JSON, and missing sub-questions", () => {
      const withImg = [good[0], good[1], good[2], { value: "v", images: [{ type: "image" }] }];
      expect(validateQuestionAnswer(p, JSON.stringify(withImg)).ok).toBe(false);
      expect(validateQuestionAnswer(p, "nope").ok).toBe(false);
      expect(validateQuestionAnswer({ type: "batch" }, "[]").ok).toBe(false);
    });
  });

  it("rejects unknown prompt types", () => {
    expect(validateQuestionAnswer({ type: "custom" }, "x").ok).toBe(false);
  });
});

// ── encoder → validator round trip (test-plan E7) ────────────────────
describe("encodePromptAnswer → validateQuestionAnswer round trip", () => {
  const cases: Array<[string, Record<string, unknown>, unknown]> = [
    ["confirm true", { type: "confirm" }, { confirmed: true }],
    ["confirm false", { type: "confirm" }, { confirmed: false }],
    ["select", { type: "select", options: ["a", "b"] }, { value: "b" }],
    ["multiselect", { type: "multiselect", options: ["a", "b"] }, { values: ["a", "b"] }],
    ["multiselect empty", { type: "multiselect", options: ["a"] }, { values: [] }],
    ["input", { type: "input" }, { value: "hi" }],
    ["input empty", { type: "input" }, { value: "" }],
    ["editor", { type: "editor" }, { value: "line1\nline2" }],
    [
      "batch",
      {
        type: "batch",
        metadata: {
          questions: [
            { method: "confirm", title: "c" },
            { method: "select", title: "s", options: ["a"] },
            { method: "multiselect", title: "m", options: ["x"] },
            { method: "input", title: "i" },
          ],
        },
      },
      { answers: [{ confirmed: false }, { value: "a" }, { values: [] }, { value: "t" }] },
    ],
  ];
  for (const [name, prompt, result] of cases) {
    it(`${name} validates`, () => {
      const encoded = encodePromptAnswer(result, false);
      expect(encoded).toBeDefined();
      expect(validateQuestionAnswer(prompt as { type: string }, encoded as string)).toEqual({ ok: true });
    });
  }
  it("confirm encodes 'true'/'false'", () => {
    expect(encodePromptAnswer({ confirmed: true }, false)).toBe("true");
    expect(encodePromptAnswer({ confirmed: false }, false)).toBe("false");
  });
});
