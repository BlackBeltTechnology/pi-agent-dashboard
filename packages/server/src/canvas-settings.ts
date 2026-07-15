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
  type CanvasKind,
  type CanvasTypes,
  DEFAULT_CANVAS_TYPES,
  mergeCanvasTypes,
} from "@blackbelt-technology/pi-dashboard-shared/canvas-types.js";
import { getPiSettingsPath } from "@blackbelt-technology/pi-dashboard-shared/managed-paths.js";

export type CanvasTypesScope = "global" | "project";

/** The 8 known non-`fallback` kinds — the only keys the writer accepts. */
const KNOWN_KINDS = new Set(Object.keys(DEFAULT_CANVAS_TYPES) as CanvasKind[]);

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

/** Settings file path for a scope. Project requires a non-empty cwd. */
function scopeFile(scope: CanvasTypesScope, cwd: string): string {
  return scope === "global"
    ? getPiSettingsPath()
    : path.join(cwd, ".pi", "settings.json");
}

/** Read both scopes + the effective merge (for the settings UI). */
export function readCanvasTypesScopes(cwd: string): {
  global: Partial<CanvasTypes>;
  project: Partial<CanvasTypes>;
  effective: CanvasTypes;
} {
  const global = readScope(getPiSettingsPath()) ?? {};
  const project = cwd ? (readScope(path.join(cwd, ".pi", "settings.json")) ?? {}) : {};
  return { global, project, effective: mergeCanvasTypes(global, project) };
}

/**
 * Keep only the 8 known boolean kinds from an untrusted input map (drops
 * unknown keys and non-booleans). Prevents an API caller writing arbitrary
 * keys into the `dashboard.canvasTypes` object.
 */
function sanitize(input: Record<string, unknown>): Partial<CanvasTypes> {
  const out: Partial<CanvasTypes> = {};
  for (const [k, v] of Object.entries(input)) {
    if (KNOWN_KINDS.has(k as CanvasKind) && typeof v === "boolean") {
      out[k as CanvasKind] = v;
    }
  }
  return out;
}

/**
 * Write `#dashboard.canvasTypes` for one scope, PRESERVING every other key in
 * the settings file (read-modify-write of the parsed JSON). Only the 8 known
 * kinds are accepted. Creates the file / `.pi` dir if absent. Returns the new
 * two-scope view. `project` scope requires a non-empty `cwd`.
 */
export function writeCanvasTypesScope(
  scope: CanvasTypesScope,
  cwd: string,
  canvasTypes: Record<string, unknown>,
): { global: Partial<CanvasTypes>; project: Partial<CanvasTypes>; effective: CanvasTypes } {
  if (scope === "project" && !cwd) {
    throw new Error("project scope requires a cwd");
  }
  const file = scopeFile(scope, cwd);
  let parsed: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) parsed = raw;
  } catch {
    parsed = {}; // absent / malformed → start fresh (other keys already gone)
  }
  const dashboard =
    parsed.dashboard && typeof parsed.dashboard === "object" && !Array.isArray(parsed.dashboard)
      ? (parsed.dashboard as Record<string, unknown>)
      : {};
  parsed.dashboard = { ...dashboard, canvasTypes: sanitize(canvasTypes) };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return readCanvasTypesScopes(cwd);
}
