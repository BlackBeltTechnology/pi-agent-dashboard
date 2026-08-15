/**
 * Depth-first traversal helpers shared by diagnostics, validation and rendering.
 * A single traversal definition keeps path strings and nesting context
 * consistent across every consumer.
 */
import type { Field, FormSchemaJSON, Section } from "./types.js";

export interface FieldVisit {
  field: Field;
  path: string;
  /** Depth of enclosing repeaters (0 at top level, >=1 inside a repeater). */
  repeaterDepth: number;
  /** Depth of enclosing matrices via repeaters is not possible; kept for symmetry. */
  insideRepeater: boolean;
  sectionPath: string;
}

/** Visit every field, descending into repeater sub-layouts. */
export function walkFields(schema: FormSchemaJSON, visit: (v: FieldVisit) => void): void {
  schema.pages.forEach((page, pi) => {
    page.sections.forEach((section, si) => {
      walkSectionFields(section, `pages[${pi}].sections[${si}]`, 0, visit);
    });
  });
}

function walkSectionFields(
  section: Section,
  sectionPath: string,
  repeaterDepth: number,
  visit: (v: FieldVisit) => void,
): void {
  section.rows.forEach((row, ri) => {
    row.columns.forEach((col, ci) => {
      col.fields.forEach((field, fi) => {
        const path = `${sectionPath}.rows[${ri}].columns[${ci}].fields[${fi}]`;
        visit({ field, path, repeaterDepth, insideRepeater: repeaterDepth > 0, sectionPath });
        if (field.type === "repeater" && field.rows) {
          field.rows.forEach((rrow, rri) => {
            rrow.columns.forEach((rcol, rci) => {
              rcol.fields.forEach((rfield, rfi) => {
                const rpath = `${path}.rows[${rri}].columns[${rci}].fields[${rfi}]`;
                visit({
                  field: rfield,
                  path: rpath,
                  repeaterDepth: repeaterDepth + 1,
                  insideRepeater: true,
                  sectionPath,
                });
                // A repeater nested inside a repeater is diagnosed elsewhere; do
                // not descend further to avoid unbounded surprising traversal.
              });
            });
          });
        }
      });
    });
  });
}

/** Collect every field key across the whole schema, including repeater children. */
export function collectFieldKeys(schema: FormSchemaJSON): string[] {
  const keys: string[] = [];
  walkFields(schema, ({ field }) => {
    if (field.type !== "header" && field.type !== "paragraph") keys.push(field.key);
  });
  return keys;
}
