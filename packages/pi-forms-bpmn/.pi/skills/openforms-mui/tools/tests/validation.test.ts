import { describe, it, expect } from "vitest";
import type { Field, FormSchemaJSON } from "../src/schema/types";
import { normalizeSchema } from "../src/schema/normalize";
import { resolveFormState } from "../src/logic/state";
import {
  deriveZodSchema,
  createMemoizedDeriver,
  FORM_LEVEL_PATH,
} from "../src/validation/zod-from-schema";
import { collectFieldDiagnostics } from "../src/validation/diagnostics";

function form(fields: Field[], extra?: Partial<FormSchemaJSON>): FormSchemaJSON {
  return normalizeSchema({
    pages: [{ sections: [{ rows: [{ columns: [{ fields }] }] }] }],
    ...extra,
  }).schema;
}

describe("Zod derivation (tasks 4.0, 4.1)", () => {
  it("maps field types to validators and accepts declared empty values", () => {
    const s = form([
      { type: "text", key: "t" },
      { type: "number", key: "n" },
      { type: "date", key: "d" },
      { type: "boolean", key: "b" },
      { type: "checkbox", key: "c", options: [] },
    ]);
    const zod = deriveZodSchema(s, resolveFormState(s, {}));
    const ok = zod.safeParse({ t: "", n: null, d: "", b: false, c: [] });
    expect(ok.success).toBe(true);
    // number rejects a wrong shape
    const bad = zod.safeParse({ t: "", n: "notnum", d: "", b: false, c: [] });
    expect(bad.success).toBe(false);
  });

  it("excludes header and paragraph fields", () => {
    const s = form([{ type: "header", key: "h" }, { type: "paragraph", key: "p" }, { type: "text", key: "t" }]);
    const zod = deriveZodSchema(s, resolveFormState(s, {}));
    // Parsing an object without h/p keys succeeds (no required key for them).
    expect(zod.safeParse({ t: "" }).success).toBe(true);
  });
});

describe("visibility-aware validation (tasks 4.2, 4.8)", () => {
  const schema = form([
    { type: "text", key: "toggle" },
    {
      type: "text",
      key: "secret",
      required: true,
      validationRegex: "^[0-9]+$",
      errorMessage: "digits only",
      conditionalRules: [
        { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "toggle", operator: "equals", equalsValue: "show" }] }] },
      ],
    },
  ]);

  it("a hidden field holding an invalid value does not block submission", () => {
    const state = resolveFormState(schema, { toggle: "hide", secret: "not-digits" });
    const zod = deriveZodSchema(schema, state);
    expect(zod.safeParse({ toggle: "hide", secret: "not-digits" }).success).toBe(true);
  });

  it("the field becomes required and constrained when revealed", () => {
    const state = resolveFormState(schema, { toggle: "show", secret: "" });
    const zod = deriveZodSchema(schema, state);
    expect(zod.safeParse({ toggle: "show", secret: "" }).success).toBe(false);
    expect(zod.safeParse({ toggle: "show", secret: "abc" }).success).toBe(false);
    expect(zod.safeParse({ toggle: "show", secret: "123" }).success).toBe(true);
  });
});

describe("memoization on derived state (tasks 4.5, 4.7)", () => {
  const schema = form([
    { type: "text", key: "toggle" },
    {
      type: "text",
      key: "dep",
      conditionalRules: [
        { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "toggle", operator: "equals", equalsValue: "x" }] }] },
      ],
    },
  ]);

  it("typing into a visible field does not rebuild the schema", () => {
    const deriver = createMemoizedDeriver(schema);
    const rebuildCount = () => (deriver as unknown as { rebuildCount(): number }).rebuildCount();
    deriver(resolveFormState(schema, { toggle: "a" }));
    expect(rebuildCount()).toBe(1);
    deriver(resolveFormState(schema, { toggle: "ab" })); // still hidden, same state
    expect(rebuildCount()).toBe(1);
  });

  it("a visibility transition rebuilds the schema", () => {
    const deriver = createMemoizedDeriver(schema);
    const rebuildCount = () => (deriver as unknown as { rebuildCount(): number }).rebuildCount();
    deriver(resolveFormState(schema, { toggle: "a" }));
    deriver(resolveFormState(schema, { toggle: "x" })); // dep now visible
    expect(rebuildCount()).toBe(2);
  });
});

describe("cross-field rules (task 4.4)", () => {
  const schema = form(
    [
      { type: "date", key: "startDate" },
      { type: "date", key: "endDate" },
    ],
    {
      crossFieldRules: [
        {
          andGroups: [{ conditions: [{ dependentFieldKey: "startDate", operator: "greaterThan", compareMode: "field", compareToFieldKey: "endDate" }] }],
          targetFields: ["startDate", "endDate"],
          errorMessage: "Start must not be after end.",
        },
      ],
    },
  );

  it("a violated rule blocks and marks every visible target", () => {
    const state = resolveFormState(schema, { startDate: "2026-07-02", endDate: "2026-07-01" });
    const zod = deriveZodSchema(schema, state);
    const res = zod.safeParse({ startDate: "2026-07-02", endDate: "2026-07-01" });
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("startDate");
      expect(paths).toContain("endDate");
    }
  });

  it("an unviolated rule permits submission", () => {
    const state = resolveFormState(schema, { startDate: "2026-07-01", endDate: "2026-07-02" });
    const zod = deriveZodSchema(schema, state);
    expect(zod.safeParse({ startDate: "2026-07-01", endDate: "2026-07-02" }).success).toBe(true);
  });

  it("a rule with all-hidden targets still blocks via the form-level path", () => {
    const hiddenSchema = form(
      [
        { type: "text", key: "toggle" },
        {
          type: "date",
          key: "startDate",
          conditionalRules: [{ targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "toggle", operator: "equals", equalsValue: "show" }] }] }],
        },
        {
          type: "date",
          key: "endDate",
          conditionalRules: [{ targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "toggle", operator: "equals", equalsValue: "show" }] }] }],
        },
      ],
      {
        crossFieldRules: [
          {
            andGroups: [{ conditions: [{ dependentFieldKey: "startDate", operator: "greaterThan", compareMode: "field", compareToFieldKey: "endDate" }] }],
            targetFields: ["startDate", "endDate"],
            errorMessage: "Start must not be after end.",
          },
        ],
      },
    );
    const answers = { toggle: "hide", startDate: "2026-07-02", endDate: "2026-07-01" };
    const state = resolveFormState(hiddenSchema, answers);
    const zod = deriveZodSchema(hiddenSchema, state);
    const res = zod.safeParse(answers);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === FORM_LEVEL_PATH)).toBe(true);
    }
  });
});

describe("disabled/calculated diagnostics reach the host (validation spec)", () => {
  it("a disabled field with a violating value is reported, not blocked", () => {
    const schema = form([
      { type: "text", key: "code", disabled: true, validationRegex: "^[0-9]+$", errorMessage: "digits" },
    ]);
    const answers = { code: "abc" };
    const state = resolveFormState(schema, answers);
    // Not blocked:
    expect(deriveZodSchema(schema, state).safeParse(answers).success).toBe(true);
    // But reported:
    const diags = collectFieldDiagnostics(schema, state, answers);
    expect(diags.some((d) => d.code === "disabled-constraint-violation")).toBe(true);
  });

  it("a non-rendered calculated value out of range is reported, not blocked", () => {
    const schema = form([
      { type: "number", key: "a" },
      { type: "number", key: "big", isCalculated: true, isVisibleOnForm: false, formulaExpression: "{a} * 1000", max: 10 },
    ]);
    const answers = { a: 5 };
    const state = resolveFormState(schema, answers);
    const diags = collectFieldDiagnostics(schema, state, state.effectiveAnswers);
    expect(diags.some((d) => d.code === "calculated-constraint-violation")).toBe(true);
  });
});

describe("repeater bounds (task 4.3)", () => {
  const schema = form([
    {
      type: "repeater",
      key: "people",
      minItems: 1,
      rows: [{ columns: [{ fields: [{ type: "text", key: "name", required: true }] }] }],
    },
  ]);
  it("fails when below minItems", () => {
    const state = resolveFormState(schema, { people: [] });
    expect(deriveZodSchema(schema, state).safeParse({ people: [] }).success).toBe(false);
  });
  it("addresses a nested child error at its array path", () => {
    const state = resolveFormState(schema, { people: [{ name: "" }] });
    const res = deriveZodSchema(schema, state).safeParse({ people: [{ name: "" }] });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.join(".") === "people.0.name")).toBe(true);
    }
  });
});
