/**
 * Auto-canvas driver (change: auto-canvas, Section 6). Consumes a session's
 * reduced `CanvasState` and drives the EXISTING split-workspace surface —
 * it does NOT introduce a new preview machine (design Decision 1: coexist).
 *
 * Responsive gate (design Decision 1, guarded IN the transition):
 *   - desktop / tablet → auto-open the winning target side-by-side / replace-chat
 *     via `openInSplit` (file) or `openLiveTarget` (loopback url).
 *   - mobile (<768w OR <600h) → NEVER yank chat; surface a tap-to-open chip.
 *
 * The gate fires on the eager-open transition AND on restore-on-reselect: the
 * effect re-runs whenever the selected session's canvas target changes, so
 * switching back to a session with an open canvas re-opens it (S27).
 *
 * Server chip (Section 7) renders independently of the file target and taps
 * through the LiveServerViewer loopback-probe path.
 */
import { isLoopbackUrl } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { useCallback, useEffect, useRef } from "react";
import { useCanvasTier } from "../hooks/useCanvasTier.js";
import { type CanvasState, gateAllowsAutoOpen } from "../lib/canvas-gate.js";
import { t as i18nT } from "../lib/i18n";
import { CanvasServerChip } from "./CanvasServerChip.js";
import { useSplitWorkspace } from "./SplitWorkspaceContext.js";

interface Props {
  /** The selected session's canvas state (empty when none). */
  state: CanvasState;
}

/**
 * Open a canvas target through the split-workspace helpers. Files open in the
 * monaco/preview split; loopback URLs open the live-server viewer (SSRF-gated).
 */
function useOpenTarget() {
  const { openInSplit, openLiveTarget, openUrlTarget } = useSplitWorkspace();
  // Stable identity across renders so effect deps don't churn.
  return useCallback(
    (state: CanvasState) => {
      const target = state.target;
      if (!target) return;
      if (target.kind === "file") {
        // Canvas auto-open (no user click) → restrictCsp so document viewers
        // block external subresources (auto-open egress ≤ manual-click, S34).
        openInSplit(target.path, undefined, true);
      } else if (target.kind === "url" && isLoopbackUrl(target.url)) {
        // Loopback dev-server URL → SSRF-gated live-server viewer.
        openLiveTarget(target.url);
      } else if (target.kind === "url") {
        // Generic url/youtube declare → the `url` split viewer renders it
        // normally, NO document CSP (S35).
        openUrlTarget(target.url);
      }
    },
    [openInSplit, openLiveTarget, openUrlTarget],
  );
}

export function CanvasDriver({ state }: Props) {
  const tier = useCanvasTier();
  const openTarget = useOpenTarget();
  const { openLiveTarget } = useSplitWorkspace();

  // Key the auto-open effect on the target identity + version so a re-write
  // (same target, version++) refreshes and a session re-select re-opens.
  const key =
    state.target == null
      ? null
      : state.target.kind === "file"
        ? `file:${state.target.cwd}:${state.target.path}:${state.version}`
        : `url:${state.target.url}:${state.version}`;
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (key == null) {
      lastKeyRef.current = null;
      return;
    }
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    if (gateAllowsAutoOpen(tier)) openTarget(state);
    // mobile: do not yank — the tap-to-open chip below handles it.
  }, [key, tier, openTarget, state]);

  const showMobileChip = tier === "mobile" && state.target != null;

  if (!state.chip && !showMobileChip) return null;

  return (
    <div data-testid="canvas-chip-tray" className="flex flex-wrap items-center gap-2 px-3 py-1">
      {showMobileChip && state.target != null && (
        <button
          type="button"
          data-testid="canvas-file-chip"
          onClick={() => openTarget(state)}
          className="flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <span className="font-medium">
            {state.title ?? i18nT("canvas.openCanvas", undefined, "Open canvas")}
          </span>
          {state.target.kind === "file" && (
            <span className="font-mono text-[var(--text-tertiary)]">{state.target.path}</span>
          )}
        </button>
      )}
      {state.chip && (
        <CanvasServerChip
          chip={state.chip}
          onTap={(loopbackUrl) => openLiveTarget(loopbackUrl)}
        />
      )}
    </div>
  );
}
