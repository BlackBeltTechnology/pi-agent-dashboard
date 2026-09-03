import { describe, it, expect } from "vitest";
import { normalizeSchema } from "../src/schema/normalize";
import { diagnose } from "../src/schema/diagnose";
import type { Field, FormSchemaJSON, Row } from "../src/schema/types";

function schemaWithFields(fields: Field[], extra?: Partial<FormSchemaJSON>): FormSchemaJSON {
  return normalizeSchema({
    pages: [{ sections: [{ rows: [{ columns: [{ fields }] }] }] }],
    ...extra,
  }).schema;
}

function codes(schema: FormSchemaJSON): string[] {
  return diagnose(schema).map((d) => d.code);
}

describe("diagnose (tasks 2.5, 2.6, 2.8)", () => {
  it("reports duplicate keys as errors", () => {
    const s = schemaWithFields([
      { type: "text", key: "dup" },
      { type: "text", key: "dup" },
    ]);
    const f = diagnose(s).find((d) => d.code === "duplicate-key");
    expect(f?.severity).toBe("error");
  });

  it("reports a repeater nested in a repeater", () => {
    const innerRow: Row = { columns: [{ fields: [{ type: "repeater", key: "inner", rows: [] }] }] };
    const s = schemaWithFields([{ type: "repeater", key: "outer", rows: [innerRow] }]);
    expect(codes(s)).toContain("repeater-in-repeater");
  });

  it("reports a matrix nested in a repeater", () => {
    const innerRow: Row = { columns: [{ fields: [{ type: "matrix", key: "m", matrixRows: [] }] }] };
    const s = schemaWithFields([{ type: "repeater", key: "outer", rows: [innerRow] }]);
    expect(codes(s)).toContain("matrix-in-repeater");
  });

  it("reports an inert conditionalRules on a repeater child", () => {
    const innerRow: Row = {
      columns: [
        {
          fields: [
            {
              type: "text",
              key: "child",
              conditionalRules: [
                { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "outer", operator: "equals", equalsValue: "x" }] }] },
              ],
            },
          ],
        },
      ],
    };
    const s = schemaWithFields([{ type: "repeater", key: "outer", rows: [innerRow] }]);
    expect(codes(s)).toContain("inert-repeater-child-rule");
  });

  it("reports empty andGroups and empty condition groups", () => {
    const s = schemaWithFields([
      { type: "text", key: "trigger" },
      {
        type: "text",
        key: "a",
        conditionalRules: [{ targetProperty: "visibility", andGroups: [] }],
      },
      {
        type: "text",
        key: "b",
        conditionalRules: [{ targetProperty: "visibility", andGroups: [{ conditions: [] }] }],
      },
    ]);
    const c = codes(s);
    expect(c).toContain("empty-and-groups");
    expect(c).toContain("empty-condition-group");
  });

  it("reports an unrecognised operator", () => {
    const s = schemaWithFields([
      { type: "text", key: "trigger" },
      {
        type: "text",
        key: "a",
        conditionalRules: [
          { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "trigger", operator: "wat" }] }] },
        ],
      },
    ]);
    expect(codes(s)).toContain("unrecognised-operator");
  });

  it("reports contains against a checkbox", () => {
    const s = schemaWithFields([
      { type: "checkbox", key: "cb", options: [{ value: "x", label: "X" }] },
      {
        type: "text",
        key: "a",
        conditionalRules: [
          { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "cb", operator: "contains", equalsValue: "x" }] }] },
        ],
      },
    ]);
    expect(codes(s)).toContain("contains-on-checkbox");
  });

  it("reports optionsType api", () => {
    const s = schemaWithFields([
      { type: "dropdown", key: "d", optionsType: "api", optionsUrl: "https://x" },
    ]);
    expect(codes(s)).toContain("options-api-unsupported");
  });

  it("reports dangling dependent and compare references", () => {
    const s = schemaWithFields([
      { type: "text", key: "a" },
      {
        type: "text",
        key: "b",
        conditionalRules: [
          { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "ghost", operator: "equals", equalsValue: "1" }] }] },
        ],
      },
      {
        type: "text",
        key: "c",
        conditionalRules: [
          { targetProperty: "visibility", andGroups: [{ conditions: [{ dependentFieldKey: "a", operator: "equals", compareMode: "field", compareToFieldKey: "phantom" }] }] },
        ],
      },
    ]);
    const c = codes(s);
    expect(c).toContain("dangling-dependent-field");
    expect(c).toContain("dangling-compare-field");
  });

  it("reports isVisibleOnForm without isCalculated", () => {
    const s = schemaWithFields([{ type: "number", key: "n", isVisibleOnForm: false }]);
    expect(codes(s)).toContain("isvisibleonform-without-calculated");
  });

  it("reports an unparseable formula", () => {
    const s = schemaWithFields([
      { type: "number", key: "n", isCalculated: true, formulaExpression: "alert(1)" },
    ]);
    expect(codes(s)).toContain("unparseable-formula");
  });

  it("reports a dangling cross-field target", () => {
    const s = schemaWithFields(
      [{ type: "text", key: "a" }],
      { crossFieldRules: [{ andGroups: [{ conditions: [{ dependentFieldKey: "a", operator: "equals", equalsValue: "1" }] }], targetFields: ["nope"], errorMessage: "e" }] },
    );
    expect(codes(s)).toContain("dangling-target-field");
  });

  it("produces no error findings for a clean schema", () => {
    const s = schemaWithFields([
      { type: "text", key: "a" },
      { type: "number", key: "n", isCalculated: true, formulaExpression: "{a} + 1" },
    ]);
    expect(diagnose(s).filter((d) => d.severity === "error")).toHaveLength(0);
  });
});
