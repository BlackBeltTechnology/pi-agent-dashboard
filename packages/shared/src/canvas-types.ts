/**
 * Canvas-type registry (policy filter over `dispatchPreview`).
 *
 * `canvasTypes: Record<CanvasKind, boolean>` over the 8 non-`fallback`
 * renderer kinds, every one defaulting `true`. Two scopes, sparse override
 * shallow-merged (the `mergeDisplayPrefs` idiom, but a NEW config path:
 * `settings.json#dashboard.canvasTypes`):
 *
 *   effective = { ...DEFAULT, ...global.canvasTypes, ...project.canvasTypes }
 *   global  → ~/.pi/agent/settings.json#dashboard.canvasTypes
 *   project → <cwd>/.pi/settings.json#dashboard.canvasTypes
 *
 * Gates DETECT only — `canvas()` declares and manual `/view`/clicks bypass it.
 *
 * See change: auto-canvas (Decision 6).
 */
import { NON_FALLBACK_KINDS, type RendererKind } from "./renderer-by-ext.js";

/** The non-`fallback` renderer kinds the registry can gate. */
export type CanvasKind = Exclude<RendererKind, "fallback">;

export type CanvasTypes = Record<CanvasKind, boolean>;

/** Every kind auto-canvases by default (opt-out baseline). */
export const DEFAULT_CANVAS_TYPES: CanvasTypes = Object.fromEntries(
  NON_FALLBACK_KINDS.map((k) => [k, true]),
) as CanvasTypes;

/**
 * Effective registry = default ← global ← project (sparse shallow merge).
 * Absent scopes leave the all-on default in place.
 */
export function mergeCanvasTypes(
  global?: Partial<CanvasTypes>,
  project?: Partial<CanvasTypes>,
): CanvasTypes {
  return {
    ...DEFAULT_CANVAS_TYPES,
    ...(global ?? {}),
    ...(project ?? {}),
  };
}
