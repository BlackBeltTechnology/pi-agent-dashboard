/**
 * Local replica of the dashboard's session-status visual language for the
 * automation board. The plugin package does NOT depend on `@client`, so it
 * cannot import `packages/client/src/lib/session-status-visuals.ts`; instead it
 * reproduces the small status→class mapping here and applies the host's
 * already-global FX classes through `HOST_FX_CLASSES` (runtime `./sdk`; no
 * literal class names here), all gated by `prefers-reduced-motion` in the host CSS.
 *
 * Every colour is a theme token (status / severity / tint), never a raw
 * palette class or literal, so the board follows every palette in light and
 * dark. The running stripe sits on the rail and the running pill only — the
 * card body stays calm. See change: polish-automation-board (design D10).
 *
 * See change: automation-ui-mockup-parity, decouple-plugins-from-core.
 */
import { HOST_FX_CLASSES } from "@blackbelt-technology/dashboard-plugin-runtime/sdk";
import { mdiRobotOutline } from "@mdi/js";
import type { RunStatus } from "../shared/automation-types.js";

/** Automation card state, derived from validity + disabled + its latest run. */
export type AutomationCardState = "running" | "orphaned" | "invalid" | "disabled" | "enabled";

export interface AutomationStateInput {
  valid: boolean;
  disabled: boolean;
  running: boolean;
  /** The automation's live run is orphaned (server lost track of it). */
  orphaned?: boolean;
}

/** Precedence: orphaned > running > invalid > disabled > enabled. */
export function deriveCardState({ valid, disabled, running, orphaned }: AutomationStateInput): AutomationCardState {
  if (orphaned) return "orphaned";
  if (running) return "running";
  if (!valid) return "invalid";
  if (disabled) return "disabled";
  return "enabled";
}

/** Status rail fill (slim left gutter) — status tokens only. */
export function railBgClass(state: AutomationCardState): string {
  switch (state) {
    case "running":
      return "bg-[var(--status-working)]";
    case "orphaned":
      return "bg-[var(--severity-warning-fg)]";
    case "invalid":
      return "bg-[var(--status-error)]";
    case "disabled":
      return "bg-[var(--bg-surface)]";
    default:
      return "bg-[var(--status-idle)]";
  }
}

/** Status dot colour (+ pulse on running, frozen under reduced motion). */
export function dotClass(state: AutomationCardState): string {
  switch (state) {
    case "running":
      return "bg-[var(--status-working)] animate-pulse motion-reduce:animate-none";
    case "orphaned":
      return "bg-[var(--severity-warning-fg)]";
    case "invalid":
      return "bg-[var(--status-error)]";
    case "disabled":
      return "bg-[var(--bg-surface)]";
    default:
      return "bg-[var(--status-idle)]";
  }
}

/** Status pill badge label by state (a word, never colour alone). */
export function pillLabel(state: AutomationCardState): string {
  return state;
}

const PILL_BASE =
  "relative isolate inline-flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-1.5 py-px text-[11px] font-semibold ";

/** Tint triple per tone (bg + fg + border tokens). */
const TONE: Record<"running" | "warning" | "error" | "neutral" | "success", string> = {
  running: "bg-[var(--tint-yellow-bg)] text-[var(--tint-yellow-fg)] border-[var(--tint-yellow-border)]",
  warning: "bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] border-[var(--severity-warning-border)]",
  error: "bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] border-[var(--severity-error-border)]",
  neutral: "bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)] border-[var(--severity-neutral-border)]",
  success: "bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)] border-[var(--severity-success-border)]",
};

/** Card status pill classes by state. */
export function pillClass(state: AutomationCardState): string {
  switch (state) {
    case "running":
      return PILL_BASE + TONE.running;
    case "orphaned":
      return PILL_BASE + TONE.warning;
    case "invalid":
      return PILL_BASE + TONE.error;
    case "disabled":
      return PILL_BASE + TONE.neutral;
    default:
      return PILL_BASE + TONE.success;
  }
}

/** Run-row status: a persisted status, or `orphaned` from the listing. */
export type RunPillStatus = RunStatus | "orphaned";

/** Run-row status pill classes. */
export function runPillClass(status: RunPillStatus): string {
  switch (status) {
    case "running":
      return PILL_BASE + TONE.running;
    case "orphaned":
      return PILL_BASE + TONE.warning;
    case "error":
      return PILL_BASE + TONE.error;
    case "stopped":
      return PILL_BASE + TONE.neutral;
    default:
      return PILL_BASE + TONE.success;
  }
}

/**
 * Barber-pole stripe overlay class for a running card's rail and running pill
 * (empty otherwise). The host overlay is `absolute inset-0`, so its container
 * must be `relative isolate overflow-hidden` (the rail + `PILL_BASE` are).
 */
export function stripeFxClass(state: AutomationCardState | RunPillStatus): string {
  return state === "running" ? `${HOST_FX_CLASSES.stripes} ${HOST_FX_CLASSES.stripesRunning}` : "";
}

/**
 * Card action button — the secondary-button recipe at the contract floor
 * (44 px touch, 36 px from `sm`), `danger` = the red tint triple.
 */
export function cardButtonClass(variant: "secondary" | "primary" | "danger" = "secondary"): string {
  const base =
    "focus-ring inline-flex items-center gap-1 rounded-md border px-3 min-h-[44px] sm:min-h-[36px] text-xs font-semibold disabled:opacity-60 ";
  if (variant === "primary") return base + "border-[var(--accent-solid)] bg-[var(--accent-solid)] text-white";
  if (variant === "danger") return base + "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)] border-[var(--tint-red-border)]";
  return base + "border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]";
}

/** Headless source icon (spawned automation runs). */
export const headlessSourceIcon = mdiRobotOutline;

/** Static neon glow + rim overlay classes for the selected card. */
export const GLOW_FX_CLASS = HOST_FX_CLASSES.glow;
export const GLOW_FX_OUTER_CLASS = HOST_FX_CLASSES.glowOuter;
export const RING_FX_CLASS = HOST_FX_CLASSES.ring;
