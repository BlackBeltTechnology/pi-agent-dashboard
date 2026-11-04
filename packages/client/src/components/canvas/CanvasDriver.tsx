/**
 * Auto-canvas driver (change: auto-canvas, Section 6). Consumes a session's
 * reduced `CanvasState` and drives the EXISTING split-workspace surface —
 * it does NOT introduce a new preview machine (design Decision 1: coexist).
 *
 * Responsive gate (design Decision 1, guarded IN the transition):
 *   - desktop / tablet → auto-open the winning target side-by-side / replace-chat
 *     via the shared `useOpenCanvasTarget` (file → `openInSplit`, `.html` →
 *     `openStaticTarget`, generic url → `openUrlTarget`; a loopback url NEVER
 *     auto-opens — it surfaces the confirm chip).
 *   - mobile (<768w OR <600h) → NEVER yank chat; surface a tap-to-open chip.
 *
 * The gate fires on the eager-open transition AND on restore-on-reselect: the
 * effect re-runs whenever the selected session's canvas target changes, so
 * switching back to a session with an open canvas re-opens it (S27).
 *
 * Server chip (Section 7) renders independently of the file target and taps
 * through the LiveServerViewer loopback-probe path.
 *
 * Chip tray placement: portaled into the App's content-height slot above the
 * composer dock (in flow, inside the chat column) while a live composer exists
 * and the chat pane is visible; otherwise a fixed bottom-right overlay. No
 * observers, no viewport maths. See change: fix-chat-transcript-layout (D5).
 */
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useCanvasTier } from "../../hooks/useCanvasTier.js";
import { setActiveCanvasPort } from "../../lib/canvas/active-canvas-target.js";
import { type CanvasState, gateAllowsAutoOpen } from "../../lib/canvas/canvas-gate.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { CanvasServerChip } from "./CanvasServerChip.js";
import { useOpenCanvasTarget } from "./useOpenCanvasTarget.js";

interface Props {
  /** The selected session's canvas state (empty when none). */
  state: CanvasState;
  /**
   * Content-height chip slot directly above the live composer dock (App-owned,
   * `composer-stack-anchor`). The tray renders INTO it, in flow. Absent / `null`
   * (no live composer) → fixed overlay at the viewport's bottom-right inset
   * (safe-area aware). See change: fix-chat-transcript-layout (D5).
   */
  anchor?: HTMLElement | null;
}

/** Resting position when there is no live composer slot. */
const FALLBACK_BOTTOM = "calc(1rem + env(safe-area-inset-bottom))";

export function CanvasDriver({ state, anchor }: Props) {
  const tier = useCanvasTier();
  const { open: openTarget } = useOpenCanvasTarget();
  const { sessionId, split } = useSplitWorkspace();
  // Publish the declared server's port so the live-server picker lists it first.
  const chipPort = state.chip?.port ?? null;
  useEffect(() => {
    setActiveCanvasPort(sessionId, chipPort);
    return () => setActiveCanvasPort(sessionId, null);
  }, [sessionId, chipPort]);

  // Key the auto-open effect on the target identity + version so a re-write
  // (same target, version++) refreshes and a session re-select re-opens.
  const key =
    state.target == null
      ? null
      : state.target.kind === "file"
        ? `file:${state.target.cwd}:${state.target.path}:${state.version}`
        : `url:${state.target.url}:${state.version}`;
  const lastKeyRef = useRef<string | null>(null);
  // Target identity WITHOUT the version: a repeat of the same target at a higher
  // version is a re-declare (bump), not a first open or a session re-select.
  const identity = key == null ? null : key.slice(0, key.lastIndexOf(":"));
  const lastIdentityRef = useRef<string | null>(null);

  useEffect(() => {
    if (key == null) {
      lastKeyRef.current = null;
      lastIdentityRef.current = null;
      return;
    }
    if (key === lastKeyRef.current) return;
    // mobile: do not yank — the tap-to-open chip below handles it. The key is
    // NOT consumed while gated, so the target still opens once the viewport
    // grows (tier is an effect dep).
    if (!gateAllowsAutoOpen(tier)) return;
    lastKeyRef.current = key;
    const bump = lastIdentityRef.current === identity;
    lastIdentityRef.current = identity;
    // Agent auto-open → background (add silently while the editor is shown).
    // A loopback URL never auto-opens: the server routes it to the confirm chip.
    if (state.target) openTarget(state.target, { opener: "agent", background: true, bump });
  }, [key, identity, tier, openTarget, state.target]);

  const showMobileChip = tier === "mobile" && state.target != null;

  if (!state.chip && !showMobileChip) return null;

  const chips = (
    <>
      {showMobileChip && state.target != null && (
        <button
          type="button"
          data-testid="canvas-file-chip"
          onClick={() => state.target && openTarget(state.target, { opener: "operator", background: false })}
          className="pointer-events-auto flex min-h-[44px] min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        >
          <span className="min-w-0 truncate font-medium">
            {state.title ?? i18nT("canvas.openCanvas", undefined, "Open canvas")}
          </span>
          {state.target.kind === "file" && (
            <span className="min-w-0 truncate font-mono text-[var(--text-tertiary)]">{state.target.path}</span>
          )}
        </button>
      )}
      {state.chip && <CanvasServerChip chip={state.chip} />}
    </>
  );

  // Live composer slot, unless the chat pane is hidden (`full` editor mode keeps
  // it mounted but `display:none`, so a chip there would be unreachable). In
  // flow: the transcript gives up the chip's height, nothing is covered. The
  // bottom gap clears the dock's Hide handle (`-translate-y-1/2`, 12/22 px).
  if (anchor != null && split.mode !== "full") {
    return createPortal(
      <div data-testid="canvas-chip-tray" className="flex flex-col items-end gap-2 pb-3 max-md:pb-6">
        {chips}
      </div>,
      anchor,
    );
  }

  return (
    <LayerPortal>
      <div
        data-testid="canvas-chip-tray"
        className="pointer-events-none fixed z-overlay flex flex-col items-end gap-2"
        style={{ right: "1rem", maxWidth: "calc(100vw - 2rem)", bottom: FALLBACK_BOTTOM }}
      >
        {chips}
      </div>
    </LayerPortal>
  );
}
