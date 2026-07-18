/**
 * Live viewport-tier hook for the auto-canvas responsive gate (change:
 * auto-canvas, Decision 1). Classifies the real viewport into the three tiers
 * the pure `canvasViewportTier` defines, wired to reactive media queries:
 *   - mobile  = <768w OR <600h  (reuses the repo's `useMobile` predicate) → chip
 *   - desktop = ≥1024w ∧ ≥600h  → side-by-side
 *   - tablet  = everything between → replace-chat
 *
 * Shared by `CanvasDriver` (gate the eager-open) and `SessionSplitView` (drive
 * the tablet replace-chat layout) so both read ONE tier source of truth.
 */

import type { ViewportTier } from "../lib/canvas/canvas-gate.js";
import { useMediaQuery } from "./useMediaQuery.js";
import { useMobile } from "./useMobile.js";

export function useCanvasTier(): ViewportTier {
  const isMobile = useMobile();
  const isWide = useMediaQuery("(min-width: 1024px)");
  if (isMobile) return "mobile";
  return isWide ? "desktop" : "tablet";
}
