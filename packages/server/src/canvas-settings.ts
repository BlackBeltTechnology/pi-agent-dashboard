/**
 * Fresh effective-`canvasTypes` read for the canvas accumulator
 * (change: auto-canvas, Decision 6).
 *
 * Reads the two config scopes on EVERY call — NO cache (S21), matching the
 * read-on-call posture of `pi-package-resolver`:
 *   global  → ~/.pi/agent/settings.json#dashboard.canvasTypes
 *   project → <cwd>/.pi/settings.json#dashboard.canvasTypes
 * Absent / malformed files fall back to the all-on default via
 * `mergeCanvasTypes`.
 *
 * See change: auto-canvas.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type CanvasTypes,
  mergeCanvasTypes,
} from "@blackbelt-technology/pi-dashboard-shared/canvas-types.js";
import { getPiSettingsPath } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";

/** Read `#dashboard.canvasTypes` from one settings file, or `undefined`. */
function readScope(file: string): Partial<CanvasTypes> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const ct = parsed?.dashboard?.canvasTypes;
    return ct && typeof ct === "object" && !Array.isArray(ct)
      ? (ct as Partial<CanvasTypes>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Effective `canvasTypes` (default ← global ← project), read fresh. */
export function readEffectiveCanvasTypes(cwd: string): CanvasTypes {
  const global = readScope(getPiSettingsPath());
  const project = cwd
    ? readScope(path.join(cwd, ".pi", "settings.json"))
    : undefined;
  return mergeCanvasTypes(global, project);
}
