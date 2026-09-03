/**
 * Breaks the FieldRenderer ↔ RepeaterField import cycle.
 *
 * A repeater renders arbitrary child fields, so it needs the renderer; the
 * renderer dispatches repeaters, so it needs the repeater. That is genuine
 * mutual recursion, not a layering mistake — but a static import cycle makes
 * module-init order load-bearing (whichever side initializes first sees
 * `undefined`), which is exactly what `noImportCycles` guards against.
 *
 * The renderer registers itself on module load; container widgets resolve it at
 * RENDER time, by which point both modules are initialized. One direction of
 * the edge becomes dynamic, so the cycle disappears without changing behaviour.
 */
import type { ComponentType } from "react";
import type { Field } from "../schema/types.js";

export interface FieldRendererProps {
  field: Field;
  namePrefix?: string;
  inRepeater?: boolean;
  revealed?: boolean;
}

let renderer: ComponentType<FieldRendererProps> | undefined;

/** Called once by `FieldRenderer.tsx` at module load. */
export function registerFieldRenderer(component: ComponentType<FieldRendererProps>): void {
  renderer = component;
}

/**
 * The registered renderer. Throws rather than rendering nothing: a missing
 * registration is a build/import-order defect, and a silent empty repeater row
 * would be far harder to trace than an explicit failure.
 */
export function getFieldRenderer(): ComponentType<FieldRendererProps> {
  if (!renderer) {
    throw new Error(
      "FieldRenderer is not registered — import './FieldRenderer.js' before rendering a container field.",
    );
  }
  return renderer;
}
