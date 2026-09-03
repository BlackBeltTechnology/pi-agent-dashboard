/**
 * Truthful required/optional marking (renderer spec, task 7.12): the component
 * marks whichever of required/optional is the *minority* among currently-visible
 * fields, and never states a convention the rendered fields do not use.
 */
import type { Field } from "../schema/types.js";
import type { FieldLogicState, FormLogicState } from "../logic/state.js";
import type { Translator } from "../i18n/index.js";

export type MarkerMode = "mark-required" | "mark-optional" | "all-required" | "none";

/** Decide the marker convention from the set of currently-visible fields. */
export function decideMarkerMode(state: FormLogicState): MarkerMode {
  let visible = 0;
  let required = 0;
  for (const fs of state.fields.values()) {
    if (!fs.visible || fs.hiddenCalculated) continue;
    // Static content and calculated read-only fields do not take part.
    if (fs.type === "header" || fs.type === "paragraph") continue;
    visible++;
    if (fs.required) required++;
  }
  if (visible === 0) return "none";
  if (required === visible) return "all-required";
  const optional = visible - required;
  // Mark the minority; ties mark optional (the less alarming choice).
  return required < optional ? "mark-required" : "mark-optional";
}

/** Compose a field label with the appropriate marker for the active mode. */
export function labelWithMarker(
  field: Field,
  fs: FieldLogicState | undefined,
  t: Translator,
  mode: MarkerMode,
): string {
  const base = t.text(field.label, field.key) || field.key;
  if (!fs) return base;
  if (mode === "mark-required" && fs.required) return `${base} ${t.ui.requiredMarker}`;
  if (mode === "mark-optional" && !fs.required) return `${base} (${t.ui.optional.toLowerCase()})`;
  return base;
}
