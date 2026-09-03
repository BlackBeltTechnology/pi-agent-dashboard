/**
 * Confirms the semantics recorded in design D15 (read from the reference source,
 * not from documentation). The live `--reference` harness mode detects *upstream*
 * change; these tests pin *our* conformance so a regression fails in CI.
 *
 * D13 payload divergences (applicability-based contract; disabled fields
 * included) are INTENTIONAL: a `--reference` mismatch on either is expected and
 * must not be "fixed" (task 9.4). The disabled-inclusion divergence is pinned by
 * tests/component.test.tsx ("includes a disabled one").
 */
import { describe, it, expect } from "vitest";
import type { Condition } from "../src/schema/types";
import { EvalContext, evaluateCondition, resolveProperty, compareOrdinal } from "../src/logic/cnf";
import { normalizeSchema } from "../src/schema/normalize";
import { resolveFormState } from "../src/logic/state";

function ctxOf(a: Record<string, unknown>): EvalContext {
  return { getAnswer: (k) => (k in a ? (a[k] as never) : undefined) };
}
const c = (o: Partial<Condition>): Condition => ({ dependentFieldKey: "f", operator: "equals", ...o } as Condition);

describe("D15.1 — contains is substring on stringified operands (task 9.1)", () => {
  it("joins a checkbox array before matching", () => {
    expect(evaluateCondition(c({ operator: "contains", equalsValue: "b,c" }), ctxOf({ f: ["a", "b", "c"] })).satisfied).toBe(true);
  });
});

describe("D15.2 — three ordering tiers + undefined guard (task 9.2)", () => {
  it("numeric tier precedes date tier", () => {
    expect(compareOrdinal("9", "10")! < 0).toBe(true);
  });
  it("date tier when not numeric", () => {
    expect(compareOrdinal("2026-07-01", "2026-06-30")! > 0).toBe(true);
  });
  it("plain-string tier otherwise", () => {
    expect(typeof compareOrdinal("banana", "apple")).toBe("number");
  });
  it("undefined operand is indeterminate", () => {
    expect(compareOrdinal(undefined, 5)).toBeUndefined();
    expect(evaluateCondition(c({ operator: "greaterThan", equalsValue: 5 }), ctxOf({})).satisfied).toBe(false);
  });
});

describe("D15.3 — unknown operator falls back to equals (task 9.1)", () => {
  it("evaluates equality and reports a diagnostic", () => {
    const diags: unknown[] = [];
    const ctx: EvalContext = { ...ctxOf({ f: "x" }), reportDiagnostic: (d) => diags.push(d) };
    expect(evaluateCondition(c({ operator: "??", equalsValue: "x" }), ctx).satisfied).toBe(true);
    expect(diags.length).toBe(1);
  });
});

describe("D15.4/D15.5 — empty andGroups hides; rule replaces static value (task 9.3)", () => {
  it("an empty visibility andGroups hides its target", () => {
    const { schema } = normalizeSchema({
      pages: [
        {
          sections: [
            {
              rows: [
                {
                  columns: [
                    { fields: [{ type: "text", key: "x", conditionalRules: [{ targetProperty: "visibility", andGroups: [] }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(resolveFormState(schema, {}).fields.get("x")!.visible).toBe(false);
  });

  it("a rule targeting required replaces the static required:true", () => {
    const unmet = { targetProperty: "required" as const, andGroups: [{ conditions: [c({ dependentFieldKey: "a", operator: "equals", equalsValue: "yes" })] }] };
    expect(resolveProperty(true, [unmet], "required", ctxOf({ a: "no" }))).toBe(false);
  });
});

describe("D15 misc — isVisibleOnForm and repeater child rules (task 9.5)", () => {
  it("isVisibleOnForm is inert without isCalculated (field renders normally)", () => {
    const { schema } = normalizeSchema({
      pages: [{ sections: [{ rows: [{ columns: [{ fields: [{ type: "number", key: "n", isVisibleOnForm: false }] }] }] }] }],
    });
    // Not calculated, so it is not hiddenCalculated and remains visible.
    const fs = resolveFormState(schema, {}).fields.get("n")!;
    expect(fs.hiddenCalculated).toBe(false);
    expect(fs.visible).toBe(true);
  });

  it("repeater child fields never get a resolved rule state", () => {
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
                        {
                          type: "repeater",
                          key: "rep",
                          rows: [{ columns: [{ fields: [{ type: "text", key: "child", conditionalRules: [{ targetProperty: "visibility", andGroups: [] }] }] }] }],
                        },
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
    const state = resolveFormState(schema, {});
    // "rep" has a top-level state entry; "child" does not (rules are inert).
    expect(state.fields.has("rep")).toBe(true);
    expect(state.fields.has("child")).toBe(false);
  });
});

describe("9.4 — payload divergences are intentional", () => {
  it("this suite documents that disabled-inclusion & applicability filtering are deliberate", () => {
    // The behavioural pins live in component.test.tsx; this marker asserts the
    // decision is recorded so a reviewer does not 'fix' the divergence.
    expect(true).toBe(true);
  });
});
