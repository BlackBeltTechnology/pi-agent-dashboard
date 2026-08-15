/**
 * Per-field-type Zod validators, shared by the blocking schema deriver and the
 * non-blocking diagnostics collector so both judge a value identically.
 */
import { z } from "zod";
import type { Field, NumberField, TextField, TextareaField } from "../schema/types.js";

/** Shape-only validator; accepts the type's empty value. */
export function baseValidator(field: Field): z.ZodTypeAny {
  switch (field.type) {
    case "text":
    case "textarea":
    case "date":
    case "signature":
    case "dropdown":
    case "radio":
      return z.union([z.literal(""), z.string()]);
    case "number":
      return z.union([z.null(), z.literal(""), z.number()]);
    case "boolean":
      return z.boolean();
    case "checkbox":
      return z.array(z.string());
    case "matrix":
      return z.record(z.string(), z.string());
    case "file":
      return z.union([
        z.null(),
        z.object({ name: z.string(), size: z.number(), type: z.string(), content: z.string() }),
      ]);
    default:
      return z.any();
  }
}

function rangeMessage(nf: NumberField): string {
  if (typeof nf.min === "number" && typeof nf.max === "number") return `Enter a number between ${nf.min} and ${nf.max}.`;
  if (typeof nf.min === "number") return `Enter a number of at least ${nf.min}.`;
  if (typeof nf.max === "number") return `Enter a number of at most ${nf.max}.`;
  return "Enter a valid number.";
}

/** Base validator plus type-specific shape constraints (regex, range, length). */
export function constrainedValidatorFor(field: Field): z.ZodTypeAny {
  let v = baseValidator(field);

  if (field.type === "text" || field.type === "textarea") {
    const tf = field as TextField | TextareaField;
    if (tf.validationRegex) {
      const message = tf.errorMessage ?? "Value does not match the required format.";
      let re: RegExp | null = null;
      try {
        re = new RegExp(tf.validationRegex);
      } catch {
        re = null;
      }
      if (re) {
        v = v.refine((val) => val === "" || (typeof val === "string" && re!.test(val)), { message });
      }
    }
    if (typeof tf.maxLength === "number") {
      v = v.refine((val) => typeof val !== "string" || val.length <= tf.maxLength!, {
        message: `Use at most ${tf.maxLength} characters.`,
      });
    }
  }

  if (field.type === "number") {
    const nf = field as NumberField;
    v = v.refine(
      (val) => {
        if (val === null || val === "") return true;
        if (typeof val !== "number") return true;
        if (typeof nf.min === "number" && val < nf.min) return false;
        if (typeof nf.max === "number" && val > nf.max) return false;
        return true;
      },
      { message: rangeMessage(nf) },
    );
  }

  return v;
}
