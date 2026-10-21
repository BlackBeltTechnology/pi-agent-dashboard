/**
 * Memoised `ToolContext.canvas` for the selected session (change:
 * improve-canvas-html-and-url-ux, D8). The returned object keeps its identity
 * until one of its three scalars changes, so it is safe as a `useMemo` dependency
 * of the tool context without re-rendering every transcript row.
 */
import { useMemo } from "react";
import { type CanvasState, type CanvasToolScalars, canvasToolScalars } from "./canvas-gate.js";

export function useCanvasToolScalars(state: CanvasState | undefined): CanvasToolScalars {
  const { key, sourceCallId, chipDeclarationId } = canvasToolScalars(state);
  return useMemo(() => ({ key, sourceCallId, chipDeclarationId }), [key, sourceCallId, chipDeclarationId]);
}
