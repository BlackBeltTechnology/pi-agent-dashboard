/**
 * Payload composition — the contract the design's three review rounds converged
 * on (D13). The submitted answers object reflects *applicability*, not rendering:
 *
 *  - A non-visible field (own rule OR hidden section) is omitted; its value is
 *    retained in form state elsewhere, not here.
 *  - A disabled field is applicable and IS included.
 *  - A calculated `isVisibleOnForm:false` field is included when effectively
 *    visible; omission wins when it also sits in a hidden branch.
 *  - Every applicable field contributes its type's empty value rather than
 *    `undefined`, so no key is dropped by JSON serialisation.
 *  - A repeater contributes exactly one top-level array; each row carries every
 *    child key (empty-value table, so a `number` child is `null`); no child key
 *    appears at top level.
 */
import type { AnswerValue, Field, FormAnswers, FormSchemaJSON, RepeaterField } from "./schema/types.js";
import type { FormLogicState } from "./logic/state.js";
import { emptyValueFor } from "./validation/empty.js";

function repeaterChildFields(field: RepeaterField): Field[] {
  return (field.rows ?? []).flatMap((r) => r.columns.flatMap((c) => c.fields));
}

function composeRepeater(field: RepeaterField, value: unknown): AnswerValue {
  const children = repeaterChildFields(field).filter(
    (c) => c.type !== "header" && c.type !== "paragraph",
  );
  const rows = Array.isArray(value) ? value : [];
  return rows.map((row) => {
    const out: Record<string, AnswerValue> = {};
    const source = (row ?? {}) as Record<string, unknown>;
    for (const child of children) {
      const v = source[child.key];
      out[child.key] = v === undefined ? emptyValueFor(child.type) : (v as AnswerValue);
    }
    return out;
  });
}

/**
 * Compose the submitted payload from a submission snapshot. `answers` must be
 * the snapshot's effective answers (calculated values already filled in).
 */
export function composePayload(
  schema: FormSchemaJSON,
  state: FormLogicState,
  answers: FormAnswers,
): FormAnswers {
  const payload: FormAnswers = {};

  schema.pages.forEach((page) => {
    page.sections.forEach((section) => {
      section.rows.forEach((row) => {
        row.columns.forEach((col) => {
          col.fields.forEach((field) => {
            if (field.type === "header" || field.type === "paragraph") return;
            const fs = state.fields.get(field.key);
            // Omission wins: a non-visible field never appears, whether hidden by
            // its own rule, a hidden section, or a hidden branch around a
            // calculated isVisibleOnForm:false field.
            if (!fs || !fs.visible) return;

            if (field.type === "repeater") {
              payload[field.key] = composeRepeater(field, answers[field.key]);
              return;
            }

            const raw = answers[field.key];
            payload[field.key] = raw === undefined ? emptyValueFor(field.type) : raw;
          });
        });
      });
    });
  });

  return payload;
}

/** The second `onSubmit` argument: segregated context + run diagnostics (D13). */
export interface SubmissionMeta<C = unknown> {
  submissionContext?: C;
  diagnostics: import("./schema/types.js").Diagnostic[];
}
