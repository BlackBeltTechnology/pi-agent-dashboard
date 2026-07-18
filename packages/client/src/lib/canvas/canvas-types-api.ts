/**
 * Client helper + pure selector for the canvas-type registry REST API.
 *
 * GET  /api/canvas-types?cwd=<cwd>            → { global, project, effective }
 * PATCH /api/canvas-types { scope, cwd?, canvasTypes } → same shape
 *
 * The registry gates DETECT only — unchecked kinds stay openable manually and
 * via `canvas()`. See change: auto-canvas (Decision 6 / task 5.2).
 */
import {
  type CanvasTypes,
  mergeCanvasTypes,
} from "@blackbelt-technology/pi-dashboard-shared/canvas-types.js";
import { getApiBase } from "../api/api-context.js";

export type CanvasTypesScope = "global" | "project";

export interface CanvasTypesResponse {
  global: Partial<CanvasTypes>;
  project: Partial<CanvasTypes>;
  effective: CanvasTypes;
}

/**
 * Which full 8-key map to display for the selected scope.
 * global → default ← global (no project override);
 * project → default ← global ← project (== effective).
 */
export function displayedCanvasTypes(
  scope: CanvasTypesScope,
  res: CanvasTypesResponse,
): CanvasTypes {
  return scope === "global"
    ? mergeCanvasTypes(res.global)
    : mergeCanvasTypes(res.global, res.project);
}

export async function getCanvasTypes(cwd: string): Promise<CanvasTypesResponse> {
  const q = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const res = await fetch(`${getApiBase()}/api/canvas-types${q}`);
  if (!res.ok) throw new Error(`GET /api/canvas-types failed (${res.status})`);
  return res.json();
}

export async function patchCanvasTypes(
  scope: CanvasTypesScope,
  cwd: string,
  canvasTypes: CanvasTypes,
): Promise<CanvasTypesResponse> {
  const res = await fetch(`${getApiBase()}/api/canvas-types`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, cwd, canvasTypes }),
  });
  if (!res.ok) throw new Error(`PATCH /api/canvas-types failed (${res.status})`);
  return res.json();
}
