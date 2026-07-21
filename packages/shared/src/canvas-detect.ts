/**
 * Canvas detect classifier — sibling of `detectOpenSpecActivity`.
 *
 * Pure, zero-I/O. Classifies the bridge-forwarded tool-event stream:
 *   - `detectCanvasIntent(toolName, args, cwd, canvasTypes?)` — per tool call,
 *     `write`/`edit` ONLY (path in `args`). Never parses `bash`. Renderability
 *     gate is the shared `RENDERER_BY_EXT`; support files + `fallback` → `null`.
 *     `cwd` comes from server session state (never the model), so the emitted
 *     `{kind:"file";cwd;path}` is anti-traversal by construction.
 *   - `selectCanvasTarget(candidates)` — per turn, priority `DECLARE > DOC`,
 *     ties by recency (last event wins). Returns a `ViewTarget` or `null`.
 *
 * The `canvasTypes` registry (Decision 6) gates DETECT only; `canvas()`
 * declares set `prio:"DECLARE"` and are not built here.
 *
 * See change: auto-canvas (Decision 2).
 */

import { type CanvasTypes, DEFAULT_CANVAS_TYPES } from "./canvas-types.js";
import { type RendererKind, rendererKindForPath } from "./renderer-by-ext.js";
import type { ViewTarget } from "./types.js";

export type CanvasPriority = "DECLARE" | "DOC";

export interface CanvasCandidate {
  /** DECLARE (agent `canvas()` call) outranks DOC (detected write/edit). */
  prio: CanvasPriority;
  /** Normalized, server-cwd-anchored view target. */
  target: ViewTarget;
  /** Renderer kind for the target (informational; DECLARE may be `fallback`). */
  kind: RendererKind;
}

/**
 * Classify a single forwarded tool call into a DOC canvas candidate, or `null`.
 * `write`/`edit` only; bash/read/skill calls never yield a candidate.
 */
export function detectCanvasIntent(
  toolName: string,
  args: Record<string, unknown> | undefined,
  cwd: string,
  canvasTypes: CanvasTypes = DEFAULT_CANVAS_TYPES,
): CanvasCandidate | null {
  if (!args) return null;
  const tool = toolName.toLowerCase();
  // write/edit only — bash command strings are NEVER path-parsed.
  if (tool !== "write" && tool !== "edit") return null;

  const path = args.path;
  if (typeof path !== "string" || path.length === 0) return null;

  const kind = rendererKindForPath(path);
  if (kind === "fallback") return null; // support file / unknown ext
  // Registry gates DETECT only. Absent config = all-on default.
  if (!canvasTypes[kind]) return null;

  return { prio: "DOC", target: { kind: "file", cwd, path }, kind };
}

/**
 * Resolve the turn's winning target from accumulated candidates.
 * DECLARE beats DOC; within the winning tier the most recent (last) wins.
 * Servers are declare-only and routed to the chip path, NOT here — no
 * `{kind:"server"}` ever reaches `selectCanvasTarget`.
 */
export function selectCanvasTarget(
  candidates: CanvasCandidate[],
): ViewTarget | null {
  if (candidates.length === 0) return null;
  const declares = candidates.filter((c) => c.prio === "DECLARE");
  const pool = declares.length > 0 ? declares : candidates;
  const winner = pool[pool.length - 1];
  return winner ? winner.target : null;
}
