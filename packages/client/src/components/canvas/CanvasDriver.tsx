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
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasTier } from "../../hooks/useCanvasTier.js";
import { type CanvasState, gateAllowsAutoOpen } from "../../lib/canvas/canvas-gate.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CanvasServerChip } from "./CanvasServerChip.js";
import { useSplitWorkspace } from "../split/SplitWorkspaceContext.js";

interface Props {
  /** The selected session's canvas state (empty when none). */
  state: CanvasState;
  /**
   * Zero-height sentinel at the top of the live composer stack (App-owned).
   * The tray floats just above its top edge. Absent / `null` → rest at the
   * viewport's bottom-right inset (safe-area aware).
   */
  anchor?: HTMLElement | null;
}

/** Gap between the tray's bottom edge and the composer stack's top edge. */
const TRAY_GAP_PX = 8;

/** Resting position when there is no live composer anchor. */
const FALLBACK_BOTTOM = "calc(1rem + env(safe-area-inset-bottom))";

/**
 * Distance (px) from the viewport bottom to just above `anchor`'s top edge,
 * or `null` while there is no anchor / it has not been measured yet.
 *
 * The sentinel is 0×0, so it never resizes when the composer stack grows — the
 * stack's growth only MOVES it. We therefore observe the sentinel (so the first
 * measure always fires), its parent pane (a pane resize moves the stack with no
 * row resizing) and every row in that pane — those after it (strip, StatusBar,
 * QueuePanel, composer root, …) and those before it (a banner or header slot
 * resizing in place) — and re-collect that set via a `childList`
 * MutationObserver when a row mounts/unmounts.
 */
function useAnchorBottom(anchor: HTMLElement | null | undefined): number | null {
  const [bottom, setBottom] = useState<number | null>(null);

  useEffect(() => {
    if (!anchor) {
      setBottom(null);
      return;
    }
    const measure = () => {
      if (!anchor.isConnected) {
        setBottom(null);
        return;
      }
      const vv = window.visualViewport;
      const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      setBottom(Math.max(0, viewportBottom - anchor.getBoundingClientRect().top + TRAY_GAP_PX));
    };

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const observeRows = () => {
      if (!ro) return;
      ro.disconnect();
      ro.observe(anchor);
      // The pane itself and EVERY row in it: a pane resize, or a row above the
      // sentinel resizing in place, can move the stack's top edge while no row
      // after the sentinel changes size.
      const pane = anchor.parentElement;
      if (pane) {
        ro.observe(pane);
        for (const row of Array.from(pane.children)) ro.observe(row);
      }
    };
    observeRows();

    const parent = anchor.parentElement;
    const mo =
      parent && typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            observeRows();
            measure();
          })
        : null;
    mo?.observe(parent as Element, { childList: true });

    window.addEventListener("resize", measure);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", measure);
    // Without ResizeObserver there is no initial callback — measure once now.
    if (!ro) measure();

    return () => {
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
    };
  }, [anchor]);

  return anchor ? bottom : null;
}

/**
 * Open a canvas target through the split-workspace helpers. Files open in the
 * monaco/preview split; loopback URLs open the live-server viewer (SSRF-gated).
 */
function useOpenTarget() {
  const { openInSplit, openLiveTarget, openUrlTarget } = useSplitWorkspace();
  // Stable identity across renders so effect deps don't churn. `background`
  // splits the two callers: the auto-open EFFECT passes `true` (agent — add
  // silently while the editor is shown); the mobile chip `onClick` passes
  // `false` (user tap — foreground). See change: non-disruptive-file-open.
  return useCallback(
    (state: CanvasState, background: boolean) => {
      const target = state.target;
      if (!target) return;
      if (target.kind === "file") {
        // Canvas auto-open (no user click) → restrictCsp so document viewers
        // block external subresources (auto-open egress ≤ manual-click, S34).
        // `restrictCsp` (egress) and `background` (focus) are orthogonal.
        // `autoOpened` is provenance: the effect (background) is the agent,
        // the chip tap is the operator — `restrictCsp` is true for both, so it
        // cannot tell them apart (surface-denial-remedy-in-previews, D4).
        openInSplit(target.path, undefined, true, { background, autoOpened: background });
      } else if (target.kind === "url" && isLoopbackUrl(target.url)) {
        // Loopback dev-server URL → SSRF-gated live-server viewer.
        openLiveTarget(target.url, { background });
      } else if (target.kind === "url") {
        // Generic url/youtube declare → the `url` split viewer renders it
        // normally, NO document CSP (S35).
        openUrlTarget(target.url, { background });
      }
    },
    [openInSplit, openLiveTarget, openUrlTarget],
  );
}

export function CanvasDriver({ state, anchor }: Props) {
  const tier = useCanvasTier();
  const anchorBottom = useAnchorBottom(anchor);
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
    // mobile: do not yank — the tap-to-open chip below handles it. The key is
    // NOT consumed while gated, so the target still opens once the viewport
    // grows (tier is an effect dep).
    if (!gateAllowsAutoOpen(tier)) return;
    lastKeyRef.current = key;
    // Agent auto-open → background (add silently while the editor is shown).
    openTarget(state, true);
  }, [key, tier, openTarget, state]);

  const showMobileChip = tier === "mobile" && state.target != null;

  if (!state.chip && !showMobileChip) return null;

  // Anchored but not yet measured → hidden, so the tray never flashes at the
  // fallback position over the composer.
  const unmeasured = anchor != null && anchorBottom == null;

  return (
    <LayerPortal>
      <div
        data-testid="canvas-chip-tray"
        className="pointer-events-none fixed z-overlay flex flex-col items-end gap-2"
        style={{
          right: "1rem",
          maxWidth: "calc(100vw - 2rem)",
          bottom: anchorBottom != null ? `${anchorBottom}px` : FALLBACK_BOTTOM,
          visibility: unmeasured ? "hidden" : undefined,
        }}
      >
        {showMobileChip && state.target != null && (
          <button
            type="button"
            data-testid="canvas-file-chip"
            onClick={() => openTarget(state, false)}
            className="pointer-events-auto flex min-h-[44px] min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            <span className="min-w-0 truncate font-medium">
              {state.title ?? i18nT("canvas.openCanvas", undefined, "Open canvas")}
            </span>
            {state.target.kind === "file" && (
              <span className="min-w-0 truncate font-mono text-[var(--text-tertiary)]">
                {state.target.path}
              </span>
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
    </LayerPortal>
  );
}
