/**
 * Non-blocking, submit-time diagnostics for fields that are exempt from blocking
 * validation but still emitted in the payload: disabled fields, rendered
 * calculated fields, and non-rendered calculated fields. A value known to
 * violate its own declared constraints must never reach a downstream consumer
 * silently, so these travel with the payload via the second `onSubmit` argument
 * (validation spec). Non-blocking does not mean unreported.
 */
import type { Diagnostic, FormAnswers, FormSchemaJSON } from "../schema/types.js";
import type { FormLogicState } from "../logic/state.js";
import { walkFields } from "../schema/walk.js";
import { isEmptyValue } from "./empty.js";
import { constrainedValidatorFor } from "./constrain.js";

export function collectFieldDiagnostics(
  schema: FormSchemaJSON,
  state: FormLogicState,
  answers: FormAnswers,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  walkFields(schema, ({ field, path, repeaterDepth }) => {
    if (repeaterDepth !== 0) return;
    if (field.type === "header" || field.type === "paragraph") return;
    const fs = state.fields.get(field.key);
    if (!fs) return;

    // Only disabled/calculated fields are exempt-but-reported. Visible editable
    // fields block instead, so no diagnostic here.
    const exemptButReported = fs.disabled || fs.calculated || fs.hiddenCalculated;
    if (!exemptButReported) return;

    const value = answers[field.key];

    // Required-but-empty (only meaningful when the field is required).
    if (fs.required && isEmptyValue(field.type, value)) {
      diagnostics.push({
        severity: "warning",
        code: "disabled-required-empty",
        message: `Field "${field.key}" is required but its (disabled/derived) value is empty; it was submitted anyway.`,
        path,
      });
      return;
    }

    // Constraint violation on a value the user cannot correct.
    if (!isEmptyValue(field.type, value)) {
      const validator = constrainedValidatorFor(field);
      const result = validator.safeParse(value);
      if (!result.success) {
        diagnostics.push({
          severity: "warning",
          code: fs.calculated || fs.hiddenCalculated ? "calculated-constraint-violation" : "disabled-constraint-violation",
          message: `Field "${field.key}" holds a value violating its constraints (${result.error.issues[0]?.message ?? "invalid"}); it was submitted anyway.`,
          path,
        });
      }
    }
  });

  return diagnostics;
}
