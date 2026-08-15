/**
 * The per-type empty-value table (renderer spec) plus an `isEmpty` predicate.
 * One definition avoids the contradiction the design's third review found: a
 * `number` empty is `null` and a `date` empty is `""`, and validators must accept
 * those before applying shape rejection (task 4.0).
 */
import type { AnswerValue, FieldType } from "../schema/types.js";

export function emptyValueFor(type: FieldType): AnswerValue {
  switch (type) {
    case "text":
    case "textarea":
    case "date":
    case "signature":
    case "dropdown":
    case "radio":
      return "";
    case "number":
      return null;
    case "boolean":
      return false;
    case "checkbox":
      return [];
    case "matrix":
      return {};
    case "repeater":
      return [];
    case "file":
      return null;
    // header / paragraph contribute no value; represented as "" if ever asked.
    default:
      return "";
  }
}

export function isEmptyValue(type: FieldType, value: unknown): boolean {
  switch (type) {
    case "number":
      return value === null || value === undefined || value === "";
    case "boolean":
      // A required boolean must be affirmatively true (e.g. a consent switch).
      return value !== true;
    case "checkbox":
    case "repeater":
      return !Array.isArray(value) || value.length === 0;
    case "matrix":
      return !value || typeof value !== "object" || Object.keys(value as object).length === 0;
    case "file":
      return value === null || value === undefined;
    default:
      return value === "" || value === null || value === undefined;
  }
}
