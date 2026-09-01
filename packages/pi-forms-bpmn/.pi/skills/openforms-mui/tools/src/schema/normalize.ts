/**
 * Non-mutating schema normalization.
 *
 * `normalizeSchema` accepts partial, empty, null, or legacy input and returns a
 * fully-populated schema plus the diagnostics raised while migrating legacy
 * forms. It deep-clones its input, so the caller's object is never mutated, and
 * generates deterministic ids (by position), so normalizing twice equals
 * normalizing once.
 */
import type {
  Column,
  ConditionalRule,
  CrossFieldRule,
  Diagnostic,
  Field,
  FormSchemaJSON,
  LegacyVisibilityCondition,
  Page,
  Row,
  Section,
} from "./types.js";

export interface NormalizeResult {
  schema: FormSchemaJSON;
  diagnostics: Diagnostic[];
}

function migrateLegacyVisibility(legacy: LegacyVisibilityCondition): ConditionalRule {
  return {
    targetProperty: "visibility",
    andGroups: [
      {
        conditions: [
          {
            dependentFieldKey: legacy.dependentFieldKey,
            operator: legacy.operator,
            ...(legacy.compareMode ? { compareMode: legacy.compareMode } : {}),
            ...(legacy.compareToFieldKey ? { compareToFieldKey: legacy.compareToFieldKey } : {}),
            ...(Object.prototype.hasOwnProperty.call(legacy, "equalsValue")
              ? { equalsValue: legacy.equalsValue }
              : {}),
          },
        ],
      },
    ],
  };
}

function normalizeField(input: Field, path: string, diagnostics: Diagnostic[]): Field {
  // Deep clone via structuredClone so nested rules/options are never shared.
  const field: Field = structuredClone(input);
  if (!field.id) field.id = `${path}-field`;

  // Legacy visibilityCondition -> conditionalRules (info diagnostic per element).
  if (field.visibilityCondition) {
    const migrated = migrateLegacyVisibility(field.visibilityCondition);
    field.conditionalRules = [...(field.conditionalRules ?? []), migrated];
    delete field.visibilityCondition;
    diagnostics.push({
      severity: "info",
      code: "legacy-visibility-migrated",
      message: `Field "${field.key}" migrated legacy visibilityCondition to a conditionalRules entry; update the source schema.`,
      path,
    });
  }

  // Recurse into a repeater's nested layout.
  if (field.type === "repeater" && field.rows) {
    field.rows = field.rows.map((row, i) => normalizeRow(row, `${path}-repeater-row-${i}`, diagnostics));
  }
  return field;
}

function normalizeColumn(input: Column, path: string, diagnostics: Diagnostic[]): Column {
  const column: Column = { ...input };
  if (!column.columnId) column.columnId = `${path}-col`;
  column.fields = (input.fields ?? []).map((f, i) =>
    normalizeField(f, `${path}-f${i}`, diagnostics),
  );
  return column;
}

function normalizeRow(input: Row, path: string, diagnostics: Diagnostic[]): Row {
  const row: Row = { ...input };
  if (!row.rowId) row.rowId = `${path}-row`;
  row.columns = (input.columns ?? []).map((c, i) =>
    normalizeColumn(c, `${path}-c${i}`, diagnostics),
  );
  return row;
}

function normalizeSection(input: Section, path: string, diagnostics: Diagnostic[]): Section {
  const section: Section = { ...input };
  if (!section.sectionId) section.sectionId = `${path}-section`;

  if (section.visibilityCondition) {
    const migrated = migrateLegacyVisibility(section.visibilityCondition);
    section.conditionalRules = [...(section.conditionalRules ?? []), migrated];
    delete section.visibilityCondition;
    diagnostics.push({
      severity: "info",
      code: "legacy-visibility-migrated",
      message: `Section "${section.sectionId}" migrated legacy visibilityCondition to a conditionalRules entry; update the source schema.`,
      path,
    });
  }
  if (section.conditionalRules) section.conditionalRules = structuredClone(section.conditionalRules);

  section.rows = (input.rows ?? []).map((r, i) =>
    normalizeRow(r, `${path}-r${i}`, diagnostics),
  );
  return section;
}

function normalizePage(input: Page, path: string, diagnostics: Diagnostic[]): Page {
  const page: Page = { ...input };
  if (!page.pageId) page.pageId = `${path}-page`;

  const sections = input.sections && input.sections.length > 0 ? input.sections : [{ rows: [] }];
  page.sections = sections.map((s, i) => normalizeSection(s, `${path}-s${i}`, diagnostics));
  return page;
}

function normalizeCrossFieldRule(
  input: CrossFieldRule,
  index: number,
  diagnostics: Diagnostic[],
): CrossFieldRule {
  const rule: CrossFieldRule = structuredClone(input);
  if (!rule.id) rule.id = `crossrule-${index}`;
  if (rule.expression && !rule.andGroups) {
    diagnostics.push({
      severity: "info",
      code: "legacy-expression-retained",
      message: `Cross-field rule "${rule.id}" uses a free-text expression; migrate it to andGroups.`,
      path: `crossFieldRules[${index}]`,
    });
  }
  return rule;
}

/**
 * Normalize an arbitrary schema-ish input into a complete `FormSchemaJSON`.
 * Never mutates its input.
 */
export function normalizeSchema(input: Partial<FormSchemaJSON> | null | undefined): NormalizeResult {
  const diagnostics: Diagnostic[] = [];

  const src = input ?? {};
  const pages = src.pages && src.pages.length > 0 ? src.pages : [{ sections: [{ rows: [] }] }];

  const schema: FormSchemaJSON = {
    ...(src.formTitle !== undefined ? { formTitle: src.formTitle } : {}),
    ...(src.formDescription !== undefined ? { formDescription: src.formDescription } : {}),
    pages: pages.map((p, i) => normalizePage(p, `p${i}`, diagnostics)),
    ...(src.crossFieldRules
      ? { crossFieldRules: src.crossFieldRules.map((r, i) => normalizeCrossFieldRule(r, i, diagnostics)) }
      : {}),
    ...(src.translations ? { translations: structuredClone(src.translations) } : {}),
  };

  return { schema, diagnostics };
}
