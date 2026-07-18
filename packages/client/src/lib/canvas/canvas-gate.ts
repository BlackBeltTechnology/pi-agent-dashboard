/**
 * Pure decision core for the auto-canvas surface (change: auto-canvas,
 * Sections 6–7). No React, no I/O — unit-testable in isolation.
 *
 * Two responsibilities:
 *   1. The responsive viewport gate (Decision 1 mobile-gate): classify the
 *      viewport into a tier and decide whether an eager-open (or a
 *      restore-on-reselect) is allowed to yank the layout, or must degrade to
 *      a chip/badge.
 *   2. The per-session canvas-state reducer: fold the two server broadcasts
 *      (`canvas_intent` two-phase eager/settle, `canvas_server_chip`) into a
 *      small immutable state the driver component renders.
 *
 * The state COEXISTS with `App.tsx previewState` + `useFileOpenRouting`; it does
 * NOT replace them (design Decision 1 — slot identity: coexist, do NOT unify).
 */

import type {
  CanvasIntentMessage,
  CanvasServerChipMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { ServerChip } from "@blackbelt-technology/pi-dashboard-shared/canvas-declare.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// ─── Responsive viewport gate ──────────────────────────────────────────────

export type ViewportTier = "desktop" | "tablet" | "mobile";

/**
 * Classify a viewport (design Decision 1 tiers, reusing the repo's existing
 * `useMobile` predicate for the mobile arm):
 *   - desktop = width ≥ 1024 AND height ≥ 600  → side-by-side
 *   - mobile  = width < 768  OR  height < 600  → chip/badge, never yank chat
 *   - tablet  = everything in between (768–1023 wide, ≥ 600 tall) → replace chat
 *
 * The mobile arm is checked FIRST so a short-but-wide landscape phone
 * (e.g. 1024×500) resolves to `mobile`, matching `useMobile`'s OR-height rule.
 */
export function canvasViewportTier(width: number, height: number): ViewportTier {
  if (width < 768 || height < 600) return "mobile";
  if (width >= 1024 && height >= 600) return "desktop";
  return "tablet";
}

/**
 * The gate guards the eager-open transition AND restore-on-reselect (design
 * Decision 1 K/#6,#7 — the gate is IN the transition, not an appended
 * sentence). Only the mobile predicate degrades to a chip; desktop
 * (side-by-side) and tablet (replace-chat) both auto-open.
 */
export function gateAllowsAutoOpen(tier: ViewportTier): boolean {
  return tier !== "mobile";
}

// ─── Per-session canvas state ───────────────────────────────────────────────

/**
 * One session's canvas slot. `target` is the winning file/url ViewTarget (or
 * null when the turn produced nothing renderable). `version` bumps every time
 * the SAME target is re-written so a mounted viewer can refresh in place
 * (Decision 1 "refresh in place, version++"). `chip` carries a declared-server
 * confirm chip (Decision 4) independently of `target` — a server never becomes
 * a ViewTarget.
 */
export interface CanvasState {
  /** Winning file/url target, or null (nothing renderable this turn). */
  target: ViewTarget | null;
  /** `pin` survives later writes; `replace` is the transient spotlight. */
  mode: "replace" | "pin";
  title?: string;
  /** Last phase applied — `eager` mid-turn liveness, `settle` at turn end. */
  phase: "eager" | "settle";
  /** Bumps on same-target rewrite so a mounted viewer refreshes. */
  version: number;
  /** Declared-server confirm chip, or null when none/expired. */
  chip: ServerChip | null;
}

export const EMPTY_CANVAS_STATE: CanvasState = {
  target: null,
  mode: "replace",
  title: undefined,
  phase: "settle",
  version: 0,
  chip: null,
};

/** Structural equality for two ViewTargets (same file cwd+path, or same url). */
export function sameTarget(a: ViewTarget | null, b: ViewTarget | null): boolean {
  if (a == null || b == null) return a === b;
  if (a.kind === "file" && b.kind === "file") return a.cwd === b.cwd && a.path === b.path;
  if (a.kind === "url" && b.kind === "url") return a.url === b.url;
  return false;
}

/**
 * Fold a `canvas_intent` broadcast into a session's canvas state.
 *
 * eager  — open/refresh immediately (Decision 1 phase 1 liveness). A `null`
 *          eager target is a no-op (nothing to open yet). A repeat of the same
 *          target bumps `version` (refresh in place); a different target
 *          replaces content (nothing pinned) or is ignored when the current
 *          slot is PINNED.
 * settle — fix which target owns the slot at turn end (Decision 1 phase 2).
 *          A `null` settle with a PINNED slot keeps the pin; otherwise it
 *          clears a transient slot back to empty (the turn produced nothing).
 */
export function reduceCanvasIntent(prev: CanvasState, msg: CanvasIntentMessage): CanvasState {
  const nextMode = msg.mode ?? "replace";

  if (msg.phase === "eager") {
    if (msg.target == null) return prev; // nothing to open yet
    // A pinned slot is not disturbed by a different eager target.
    if (prev.mode === "pin" && prev.target != null && !sameTarget(prev.target, msg.target)) {
      return prev;
    }
    if (sameTarget(prev.target, msg.target)) {
      return { ...prev, phase: "eager", mode: nextMode, title: msg.title, version: prev.version + 1 };
    }
    return {
      ...prev,
      target: msg.target,
      mode: nextMode,
      title: msg.title,
      phase: "eager",
      version: prev.version + 1,
    };
  }

  // phase === "settle"
  if (msg.target == null) {
    // Keep a pin; drop a transient.
    if (prev.mode === "pin" && prev.target != null) return { ...prev, phase: "settle" };
    return { ...EMPTY_CANVAS_STATE, chip: prev.chip };
  }
  if (sameTarget(prev.target, msg.target)) {
    return { ...prev, phase: "settle", mode: nextMode, title: msg.title };
  }
  return {
    ...prev,
    target: msg.target,
    mode: nextMode,
    title: msg.title,
    phase: "settle",
    version: prev.version + 1,
  };
}

/**
 * Fold a `canvas_server_chip` broadcast. A normal broadcast surfaces the chip
 * (no probe here — the probe is the human's tap). An `expire:true` broadcast
 * (turn boundary / server-exit, S32) drops the matching chip so it becomes
 * non-actionable; `port` echoes the expired chip, guarding against dropping a
 * newer chip on a different port.
 */
export function reduceCanvasChip(prev: CanvasState, msg: CanvasServerChipMessage): CanvasState {
  if (msg.expire) {
    if (prev.chip != null && prev.chip.port === msg.port) return expireCanvasChip(prev);
    return prev;
  }
  return { ...prev, chip: { kind: "server", port: msg.port, title: msg.title } };
}

/** Drop the server chip (turn boundary / server-exit expiry, Decision 4 S32). */
export function expireCanvasChip(prev: CanvasState): CanvasState {
  if (prev.chip == null) return prev;
  return { ...prev, chip: null };
}

// ─── Server-chip tap probe classification ───────────────────────────────────

/** Observable result of the on-tap loopback probe (CanvasServerChip). */
export interface ServerProbeInput {
  /** The 3000ms client timeout fired before any response (S31). */
  aborted: boolean;
  /** The proxy responded with a 2xx/3xx (the loopback server is reachable). */
  ok: boolean;
}

export type ServerProbeOutcome = "iframe" | "not-running" | "not-responding";

/**
 * Pure decision for what a server-chip tap does with its probe result
 * (Decision 4 / Section 7):
 *   - aborted (>3000ms, no response) → "not-responding" (S31), no iframe.
 *   - responded but not ok (connection refused / proxy error) → "not-running"
 *     (S30), no iframe.
 *   - responded ok → "iframe" (open the live-server viewer).
 * The timeout arm is checked FIRST: an abort never carries a usable status.
 */
export function classifyServerProbe(input: ServerProbeInput): ServerProbeOutcome {
  if (input.aborted) return "not-responding";
  if (!input.ok) return "not-running";
  return "iframe";
}
