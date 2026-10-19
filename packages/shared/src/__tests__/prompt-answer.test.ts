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
import { encodePromptAnswer, hasOwnOtherOption, isOtherAllowed, validateQuestionAnswer } from "../prompt-answer.js";

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
    it("malformed sub-question metadata yields a validation failure, never a throw", () => {
      for (const options of [5, "ab", { 0: "a" }, null, true]) {
        const bad = { type: "batch", metadata: { questions: [{ method: "select", title: "s", options }] } };
        expect(() => validateQuestionAnswer(bad as never, JSON.stringify([{ value: "a" }]))).not.toThrow();
        expect(validateQuestionAnswer(bad as never, JSON.stringify([{ value: "a" }])).ok).toBe(false);
      }
      const prims = { type: "batch", metadata: { questions: [null, 7, "x"] } };
      expect(validateQuestionAnswer(prims as never, JSON.stringify([{}, {}, {}])).ok).toBe(false);
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

// ── Inline "Other" answer — See change: add-ask-user-inline-other ────
describe("isOtherAllowed (test-plan E1)", () => {
  const allows = [undefined, true, false, "true"] as const;
  const optionSets: string[][] = [[], ["A", "B"], ["A", "Other (describe)"]];
  for (const allowOther of allows) {
    for (const options of optionSets) {
      const expected = allowOther === true && options.length === 2 && options[1] === "B";
      it(`allowOther=${JSON.stringify(allowOther)} options=${JSON.stringify(options)} → ${expected}`, () => {
        expect(isOtherAllowed({ allowOther: allowOther as boolean | undefined, options })).toBe(expected);
      });
    }
  }
  it("is false without options", () => {
    expect(isOtherAllowed({ allowOther: true })).toBe(false);
  });
});

describe("hasOwnOtherOption (test-plan E2)", () => {
  for (const o of ["Other (describe)", "other", " Other: x", "Other — describe", "Other-wise"]) {
    it(`suppresses for ${JSON.stringify(o)}`, () => expect(hasOwnOtherOption([o])).toBe(true));
  }
  for (const o of ["Others", "Otherwise", "Others will decide", "Other1", "Otheré"]) {
    it(`does not suppress for ${JSON.stringify(o)}`, () => expect(hasOwnOtherOption([o])).toBe(false));
  }
  it("never throws on non-strings", () => {
    expect(hasOwnOtherOption([42 as unknown as string, null as unknown as string])).toBe(false);
  });
});

describe("validateQuestionAnswer with allowOther", () => {
  const sel = { type: "select", options: ["A", "B"], allowOther: true };
  it("select (E3)", () => {
    expect(validateQuestionAnswer(sel, "C")).toEqual({ ok: true });
    expect(validateQuestionAnswer(sel, "A")).toEqual({ ok: true });
    expect(validateQuestionAnswer(sel, "").ok).toBe(false);
    expect(validateQuestionAnswer(sel, "   ").ok).toBe(false);
    expect(validateQuestionAnswer(sel, " A ").ok).toBe(false);
    expect(validateQuestionAnswer({ type: "select", options: ["A", "B"] }, "C").ok).toBe(false);
  });
  const multi = { type: "multiselect", options: ["A", "B"], allowOther: true };
  it("multiselect (E4)", () => {
    expect(validateQuestionAnswer(multi, '["A","D"]')).toEqual({ ok: true });
    expect(validateQuestionAnswer(multi, '["D"]')).toEqual({ ok: true });
    expect(validateQuestionAnswer(multi, "[]")).toEqual({ ok: true });
    expect(validateQuestionAnswer(multi, '["D","E"]').ok).toBe(false);
    expect(validateQuestionAnswer(multi, '["D","D"]').ok).toBe(false);
    expect(validateQuestionAnswer(multi, '["A","A"]').ok).toBe(false);
    expect(validateQuestionAnswer(multi, '["A"," D"]').ok).toBe(false);
    expect(validateQuestionAnswer({ type: "multiselect", options: ["A", "B"] }, '["A","D"]').ok).toBe(false);
  });
  it("batch (E5)", () => {
    const prompt = {
      type: "batch",
      metadata: {
        questions: [
          { method: "select", title: "s0", options: ["A", "B"], allowOther: true },
          { method: "select", title: "s1", options: ["A", "B"] },
          { method: "select", title: "s2", options: ["A", "Other (describe)"], allowOther: true },
          { method: "confirm", title: "c" },
          { method: "input", title: "i" },
        ],
      },
    };
    const base = [{ value: "A" }, { value: "A" }, { value: "A" }, { confirmed: true }, { value: "t" }];
    const withAt = (i: number, v: unknown) => JSON.stringify(base.map((e, j) => (j === i ? v : e)));
    expect(validateQuestionAnswer(prompt, withAt(0, { value: "C" }))).toEqual({ ok: true });
    const r1 = validateQuestionAnswer(prompt, withAt(1, { value: "C" }));
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.reason).toContain("batch[1]");
    const r2 = validateQuestionAnswer(prompt, withAt(2, { value: "C" }));
    expect(r2.ok).toBe(false);
    expect(!r2.ok && r2.reason).toContain("batch[2]");
    expect(validateQuestionAnswer(prompt, JSON.stringify(base))).toEqual({ ok: true });
    expect(validateQuestionAnswer(prompt, withAt(3, { confirmed: "x" })).ok).toBe(false);
    expect(validateQuestionAnswer(prompt, withAt(4, { value: 1 })).ok).toBe(false);
  });
  it("batch multiselect custom value", () => {
    const prompt = {
      type: "batch",
      metadata: { questions: [{ method: "multiselect", title: "m", options: ["A", "B"], allowOther: true }] },
    };
    expect(validateQuestionAnswer(prompt, '[{"values":["A","D"]}]')).toEqual({ ok: true });
    expect(validateQuestionAnswer(prompt, '[{"values":["D","E"]}]').ok).toBe(false);
  });
  it("non-string options do not throw (X2)", () => {
    const prompt = {
      type: "batch",
      metadata: { questions: [{ method: "select", title: "s", options: [1, 2], allowOther: true }] },
    };
    expect(() => validateQuestionAnswer(prompt, '[{"value":"x"}]')).not.toThrow();
    expect(() =>
      validateQuestionAnswer({ type: "select", options: [1, "A"] as unknown as string[], allowOther: true }, "z"),
    ).not.toThrow();
  });
});

describe("custom answers encode like option answers (E6)", () => {
  it("encodes plain strings / arrays unchanged", () => {
    expect(encodePromptAnswer({ value: "something else" }, false)).toBe("something else");
    expect(encodePromptAnswer({ values: ["A", "D"] }, false)).toBe('["A","D"]');
    const answers = [{ value: "C" }, { values: ["A", "D"] }];
    expect(encodePromptAnswer({ answers }, false)).toBe(JSON.stringify(answers));
  });
});
