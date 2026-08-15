import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Condition, ConditionalRule } from "../src/schema/types";
import { EvalContext, evaluateCondition, evaluateRule, resolveProperty, compareOrdinal } from "../src/logic/cnf";
import { evaluateFormula } from "../src/logic/formula";
import { normalizeSchema } from "../src/schema/normalize";
import { resolveFormState, computeCalculatedValues } from "../src/logic/state";

function ctxOf(answers: Record<string, unknown>): EvalContext {
  return { getAnswer: (k) => (k in answers ? (answers[k] as never) : undefined) };
}
function cond(c: Partial<Condition>): Condition {
  return { dependentFieldKey: "f", operator: "equals", ...c } as Condition;
}
function rule(andGroups: ConditionalRule["andGroups"]): ConditionalRule {
  return { targetProperty: "visibility", andGroups };
}

describe("operators (tasks 3.2, 3.3)", () => {
  it("equals matches strict and coerced", () => {
    expect(evaluateCondition(cond({ operator: "equals", equalsValue: "1" }), ctxOf({ f: 1 })).satisfied).toBe(true);
    expect(evaluateCondition(cond({ operator: "equals", equalsValue: "1" }), ctxOf({ f: "1" })).satisfied).toBe(true);
    expect(evaluateCondition(cond({ operator: "notEquals", equalsValue: "2" }), ctxOf({ f: 1 })).satisfied).toBe(true);
  });
  it("contains is a case-insensitive substring on stringified operands", () => {
    expect(evaluateCondition(cond({ operator: "contains", equalsValue: "pest" }), ctxOf({ f: "Budapest" })).satisfied).toBe(true);
    expect(evaluateCondition(cond({ operator: "contains", equalsValue: "beta" }), ctxOf({ f: ["alpha", "beta"] })).satisfied).toBe(true);
    expect(evaluateCondition(cond({ operator: "notContains", equalsValue: "x" }), ctxOf({ f: undefined })).satisfied).toBe(true);
  });
});

describe("ordering (tasks 3.4, 3.5)", () => {
  it("compares numerically before dates", () => {
    expect(compareOrdinal(9, 10)! < 0).toBe(true);
    expect(compareOrdinal("9", "10")! < 0).toBe(true); // numeric, not string ("9">"10")
  });
  it("compares dates chronologically", () => {
    expect(evaluateCondition(cond({ operator: "greaterThan", equalsValue: "2026-06-30" }), ctxOf({ f: "2026-07-01" })).satisfied).toBe(true);
  });
  it("falls back to locale string compare", () => {
    expect(typeof compareOrdinal("apple", "banana")).toBe("number");
  });
  it("undefined operand makes every ordering operator false", () => {
    for (const op of ["greaterThan", "greaterThanOrEquals", "lessThan", "lessThanOrEquals"] as const) {
      expect(evaluateCondition(cond({ operator: op, equalsValue: 5 }), ctxOf({})).satisfied).toBe(false);
    }
  });
});

describe("aliases and unknown operators (tasks 3.2, 3.7)", () => {
  it("gte behaves like greaterThanOrEquals", () => {
    expect(evaluateCondition(cond({ operator: "gte", equalsValue: 5 }), ctxOf({ f: 5 })).satisfied).toBe(true);
  });
  it("unknown operator falls back to equals with a diagnostic", () => {
    const diags: unknown[] = [];
    const ctx: EvalContext = { ...ctxOf({ f: "x" }), reportDiagnostic: (d) => diags.push(d) };
    expect(evaluateCondition(cond({ operator: "weird", equalsValue: "x" }), ctx).satisfied).toBe(true);
    expect(diags).toHaveLength(1);
  });
});

describe("CNF truth tables (task 3.1)", () => {
  const c1 = cond({ dependentFieldKey: "a", operator: "equals", equalsValue: "1" });
  const c2 = cond({ dependentFieldKey: "b", operator: "equals", equalsValue: "1" });
  it("OR within a group", () => {
    expect(evaluateRule(rule([{ conditions: [c1, c2] }]), ctxOf({ a: "1", b: "0" })).satisfied).toBe(true);
  });
  it("AND between groups", () => {
    expect(evaluateRule(rule([{ conditions: [c1] }, { conditions: [c2] }]), ctxOf({ a: "1", b: "0" })).satisfied).toBe(false);
  });
  it("empty andGroups is never satisfied", () => {
    expect(evaluateRule(rule([]), ctxOf({})).satisfied).toBe(false);
  });
  it("empty condition group is never satisfied", () => {
    expect(evaluateRule(rule([{ conditions: [] }]), ctxOf({})).satisfied).toBe(false);
  });
});

describe("property replacement (task 3.9)", () => {
  const unmet = rule([{ conditions: [cond({ dependentFieldKey: "a", operator: "equals", equalsValue: "yes" })] }]);
  it("an unsatisfied required rule overrides a static required:true", () => {
    const req: ConditionalRule = { ...unmet, targetProperty: "required" };
    expect(resolveProperty(true, [req], "required", ctxOf({ a: "no" }))).toBe(false);
  });
  it("no rule leaves the static value intact", () => {
    expect(resolveProperty(true, [], "required", ctxOf({}))).toBe(true);
  });
  it("multiple rules combine as OR", () => {
    const r1 = rule([{ conditions: [cond({ dependentFieldKey: "a", operator: "equals", equalsValue: "1" })] }]);
    const r2 = rule([{ conditions: [cond({ dependentFieldKey: "b", operator: "equals", equalsValue: "1" })] }]);
    expect(resolveProperty(false, [r1, r2], "visibility", ctxOf({ a: "0", b: "1" }))).toBe(true);
  });
});

describe("section gating (task 3.8)", () => {
  it("a hidden section hides its fields", () => {
    const { schema } = normalizeSchema({
      pages: [
        {
          sections: [
            {
              conditionalRules: [rule([{ conditions: [cond({ dependentFieldKey: "toggle", operator: "equals", equalsValue: "show" })] }])],
              rows: [{ columns: [{ fields: [{ type: "text", key: "inside" }] }] }],
            },
          ],
        },
      ],
    });
    const hidden = resolveFormState(schema, { toggle: "hide" });
    expect(hidden.fields.get("inside")!.visible).toBe(false);
    const shown = resolveFormState(schema, { toggle: "show" });
    expect(shown.fields.get("inside")!.visible).toBe(true);
  });
});

describe("formula parser (tasks 3.10, 3.11, 3.12)", () => {
  const refs = (m: Record<string, number>) => (k: string) => m[k] ?? 0;
  it("evaluates arithmetic over field references", () => {
    expect(evaluateFormula("{devShare} + {pmShare}", refs({ devShare: 10, pmShare: 15 })).value).toBe(25);
  });
  it("supports Math.round", () => {
    expect(evaluateFormula("Math.round({total} / 3)", refs({ total: 10 })).value).toBe(3);
  });
  it("supports ternary and comparison", () => {
    expect(evaluateFormula("{a} > 5 ? 100 : 0", refs({ a: 9 })).value).toBe(100);
  });
  it("returns 0 and an error for out-of-grammar input", () => {
    for (const bad of ["alert(1)", "{a}.constructor", "process.exit(1)", "1 + foo(2)", "`x`"]) {
      const r = evaluateFormula(bad, refs({ a: 1 }));
      expect(r.value).toBe(0);
      expect(r.error).toBeTruthy();
    }
  });
  it("recomputes calculated fields including hidden ones", () => {
    const { schema } = normalizeSchema({
      pages: [
        {
          sections: [
            {
              rows: [
                {
                  columns: [
                    {
                      fields: [
                        { type: "number", key: "a" },
                        { type: "number", key: "b" },
                        { type: "number", key: "sum", isCalculated: true, isVisibleOnForm: false, formulaExpression: "{a} + {b}" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const { answers } = computeCalculatedValues(schema, { a: 3, b: 4 });
    expect(answers.sum).toBe(7);
  });
});

describe("no code-construction primitive exists (task 3.11)", () => {
  it("formula.ts source contains no eval or Function constructor", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "src", "logic", "formula.ts"), "utf8");
    // Strip comments and doc references to avoid false positives on the word 'eval'.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(/\beval\s*\(/.test(code)).toBe(false);
    expect(/new\s+Function\s*\(/.test(code)).toBe(false);
    expect(/\bFunction\s*\(/.test(code)).toBe(false);
  });
});
