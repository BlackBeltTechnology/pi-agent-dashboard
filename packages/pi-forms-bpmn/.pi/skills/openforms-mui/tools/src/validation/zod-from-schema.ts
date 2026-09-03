/**
 * Derive a Zod schema from a `FormSchemaJSON` and the current `FormLogicState`.
 *
 * Rules encoded here (validation spec):
 *  - A non-visible field is exempt from EVERY constraint (not merely required).
 *  - A disabled field (including a rendered calculated field) never blocks; its
 *    constraint violations are reported as diagnostics, delivered out of band.
 *  - `crossFieldRules` attach as a `superRefine`: a satisfied rule is a
 *    violation; its `errorMessage` marks every currently-visible, non-disabled
 *    `targetFields` entry, and otherwise surfaces form-level (summary only).
 *  - Every non-required validator accepts its type's declared empty value.
 */
import { z } from "zod";
import type { FormAnswers, FormSchemaJSON, RepeaterField } from "../schema/types.js";
import type { FormLogicState } from "../logic/state.js";
import { EvalContext, evaluateRule } from "../logic/cnf.js";
import { isEmptyValue } from "./empty.js";
import { constrainedValidatorFor } from "./constrain.js";

/** Form-level (unlinked) issues carry this sentinel as their sole path element. */
export const FORM_LEVEL_PATH = "__form__";

// ---------------------------------------------------------------------------
// Repeater child object validator (children have no visibility rules)
// ---------------------------------------------------------------------------

function repeaterChildValidator(field: RepeaterField): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const row of field.rows ?? []) {
    for (const col of row.columns) {
      for (const child of col.fields) {
        if (child.type === "header" || child.type === "paragraph") continue;
        let cv = constrainedValidatorFor(child);
        if (child.required) {
          cv = cv.refine((val) => !isEmptyValue(child.type, val), {
            message: `${child.label ?? child.key} is required.`,
          });
        }
        shape[child.key] = cv;
      }
    }
  }
  let arr: z.ZodTypeAny = z.array(z.object(shape));
  if (typeof field.minItems === "number") {
    arr = (arr as z.ZodArray<z.ZodTypeAny>).min(field.minItems, {
      message: `Add at least ${field.minItems} item${field.minItems === 1 ? "" : "s"}.`,
    });
  }
  if (typeof field.maxItems === "number") {
    arr = (arr as z.ZodArray<z.ZodTypeAny>).max(field.maxItems, {
      message: `Add at most ${field.maxItems} items.`,
    });
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Whole-form schema
// ---------------------------------------------------------------------------

export interface DeriveOptions {
  /** Cross-field messages that could not attach to a field, for the summary. */
  formLevelSink?: string[];
}

export function deriveZodSchema(
  schema: FormSchemaJSON,
  state: FormLogicState,
): z.ZodType<FormAnswers> {
  const shape: Record<string, z.ZodTypeAny> = {};

  schema.pages.forEach((page) => {
    page.sections.forEach((section) => {
      section.rows.forEach((row) => {
        row.columns.forEach((col) => {
          col.fields.forEach((field) => {
            if (field.type === "header" || field.type === "paragraph") return;
            const fs = state.fields.get(field.key);

            // Not visible OR disabled/calculated => never blocks. Accept anything.
            if (!fs || !fs.visible || fs.disabled) {
              shape[field.key] = z.any();
              return;
            }

            if (field.type === "repeater") {
              shape[field.key] = repeaterChildValidator(field);
              return;
            }

            let v = constrainedValidatorFor(field);
            if (fs.required) {
              v = v.refine((val) => !isEmptyValue(field.type, val), {
                message: `${field.label ?? field.key} is required.`,
              });
            }
            shape[field.key] = v;
          });
        });
      });
    });
  });

  const object = z.object(shape).catchall(z.any());

  // Cross-field rules as a refinement over the whole (retained) answers object.
  return object.superRefine((values, ctx) => {
    const answers = values as FormAnswers;
    const evalCtx: EvalContext = {
      getAnswer: (k) => (Object.prototype.hasOwnProperty.call(answers, k) ? answers[k] : undefined),
    };
    for (const rule of schema.crossFieldRules ?? []) {
      if (!rule.andGroups || rule.andGroups.length === 0) continue; // inert never blocks
      const violated = evaluateRule(rule, evalCtx).satisfied;
      if (!violated) continue;

      const attachable = (rule.targetFields ?? []).filter((key) => {
        const fs = state.fields.get(key);
        return fs && fs.visible && !fs.disabled;
      });

      if (attachable.length > 0) {
        for (const key of attachable) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: rule.errorMessage, path: [key] });
        }
      } else {
        // No addressable target: surface as a form-level (summary-only) issue.
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: rule.errorMessage, path: [FORM_LEVEL_PATH] });
      }
    }
  }) as unknown as z.ZodType<FormAnswers>;
}

// ---------------------------------------------------------------------------
// Memoization on the derived-state signature (task 4.5)
// ---------------------------------------------------------------------------

/** Serialize only the visibility/required/disabled map — never answer values. */
export function stateSignature(state: FormLogicState): string {
  const parts: string[] = [];
  for (const key of [...state.fields.keys()].sort()) {
    const f = state.fields.get(key)!;
    parts.push(`${key}:${f.visible ? 1 : 0}${f.required ? 1 : 0}${f.disabled ? 1 : 0}`);
  }
  for (const key of [...state.sections.keys()].sort()) {
    parts.push(`§${key}:${state.sections.get(key) ? 1 : 0}`);
  }
  return parts.join("|");
}

/** Create a deriver that rebuilds only when the state signature changes. */
export function createMemoizedDeriver(
  schema: FormSchemaJSON,
): (state: FormLogicState) => z.ZodType<FormAnswers> {
  let lastSig: string | null = null;
  let cached: z.ZodType<FormAnswers> | null = null;
  let rebuildCount = 0;
  const deriver = (state: FormLogicState): z.ZodType<FormAnswers> => {
    const sig = stateSignature(state);
    if (sig !== lastSig || cached === null) {
      cached = deriveZodSchema(schema, state);
      lastSig = sig;
      rebuildCount++;
    }
    return cached;
  };
  (deriver as { rebuildCount?: () => number }).rebuildCount = () => rebuildCount;
  return deriver;
}
