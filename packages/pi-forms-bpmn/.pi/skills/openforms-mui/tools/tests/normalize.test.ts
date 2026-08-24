import { describe, it, expect } from "vitest";
import { normalizeSchema } from "../src/schema/normalize";
import type { FormSchemaJSON } from "../src/schema/types";

describe("normalizeSchema (tasks 2.3, 2.4, 2.7)", () => {
  it("produces one page with one empty section from empty/null input", () => {
    for (const input of [{}, null, undefined]) {
      const { schema } = normalizeSchema(input as never);
      expect(schema.pages).toHaveLength(1);
      expect(schema.pages[0].sections).toHaveLength(1);
      expect(schema.pages[0].sections[0].rows).toEqual([]);
    }
  });

  it("generates identifiers where absent and preserves existing ones", () => {
    const input: Partial<FormSchemaJSON> = {
      pages: [
        {
          pageId: "keep-me",
          sections: [
            { rows: [{ columns: [{ fields: [{ type: "text", key: "a" }] }] }] },
          ],
        },
      ],
    };
    const { schema } = normalizeSchema(input);
    expect(schema.pages[0].pageId).toBe("keep-me");
    expect(schema.pages[0].sections[0].sectionId).toBeTruthy();
    expect(schema.pages[0].sections[0].rows[0].rowId).toBeTruthy();
    expect(schema.pages[0].sections[0].rows[0].columns[0].fields[0].id).toBeTruthy();
  });

  it("does not mutate its input", () => {
    const input: Partial<FormSchemaJSON> = {
      pages: [{ sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "a" }] }] }] }] }],
    };
    const snapshot = JSON.stringify(input);
    normalizeSchema(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("is idempotent: normalize(normalize(x)) deep-equals normalize(x)", () => {
    const input: Partial<FormSchemaJSON> = {
      formTitle: "T",
      pages: [
        {
          sections: [
            { rows: [{ columns: [{ width: 6, fields: [{ type: "text", key: "a" }] }] }] },
          ],
        },
      ],
    };
    const once = normalizeSchema(input).schema;
    const twice = normalizeSchema(once).schema;
    expect(twice).toEqual(once);
  });

  it("migrates a legacy visibilityCondition and emits an info diagnostic", () => {
    const input: Partial<FormSchemaJSON> = {
      pages: [
        {
          sections: [
            {
              rows: [
                {
                  columns: [
                    {
                      fields: [
                        { type: "text", key: "trigger" },
                        {
                          type: "text",
                          key: "dependent",
                          visibilityCondition: {
                            dependentFieldKey: "trigger",
                            operator: "equals",
                            equalsValue: "yes",
                          },
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
    };
    const { schema, diagnostics } = normalizeSchema(input);
    const dependent = schema.pages[0].sections[0].rows[0].columns[0].fields[1];
    expect(dependent.conditionalRules?.[0].targetProperty).toBe("visibility");
    expect(dependent.visibilityCondition).toBeUndefined();
    expect(diagnostics.some((d) => d.severity === "info" && d.code === "legacy-visibility-migrated")).toBe(true);
  });

  it("retains a legacy cross-field expression with a migration hint", () => {
    const input: Partial<FormSchemaJSON> = {
      pages: [{ sections: [{ rows: [] }] }],
      crossFieldRules: [{ expression: "{a} > {b}", targetFields: ["a"], errorMessage: "bad" }],
    };
    const { schema, diagnostics } = normalizeSchema(input);
    expect(schema.crossFieldRules?.[0].expression).toBe("{a} > {b}");
    expect(diagnostics.some((d) => d.code === "legacy-expression-retained")).toBe(true);
  });
});
