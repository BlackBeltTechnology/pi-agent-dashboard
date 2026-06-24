/**
 * Local replica of the dashboard's session-status visual language for the
 * automation board. The plugin package does NOT depend on `@client`, so it
 * cannot import `packages/client/src/lib/session-status-visuals.ts`; instead it
 * reproduces the small status→class mapping here and applies the host's
 * already-global FX classes by name (`.card-stripes-fx`/`.card-stripes-running`,
 * `.card-glow-fx`/`.card-glow-fx-outer`/`.card-ring-fx`), all gated by
 * `prefers-reduced-motion` in the host CSS.
 *
 * See change: automation-ui-mockup-parity.
 */
import { mdiRobotOutline } from "@mdi/js";

/** Automation card state, derived from validity + disabled + a running run. */
export type AutomationCardState = "running" | "invalid" | "disabled" | "enabled";

export interface AutomationStateInput {
  valid: boolean;
  disabled: boolean;
  running: boolean;
}

/** Precedence: running (amber) > invalid (red) > disabled (muted) > enabled (green). */
export function deriveCardState({ valid, disabled, running }: AutomationStateInput): AutomationCardState {
  if (running) return "running";
  if (!valid) return "invalid";
  if (disabled) return "disabled";
  return "enabled";
}

/** Status rail bg color (slim left gutter), mirroring deriveRailBgColor tints. */
export function railBgClass(state: AutomationCardState): string {
  switch (state) {
    case "running":
      return "bg-yellow-500/40";
    case "invalid":
      return "bg-red-500/40";
    case "disabled":
      return "bg-[var(--bg-surface)]";
    default:
      return "bg-green-500/40";
  }
}

/** Status dot color (+ pulse on running), mirroring the shared statusColors. */
export function dotClass(state: AutomationCardState): string {
  switch (state) {
    case "running":
      return "bg-yellow-500 animate-pulse motion-reduce:animate-none";
    case "invalid":
      return "bg-red-500";
    case "disabled":
      return "bg-[var(--bg-surface)]";
    default:
      return "bg-green-500";
  }
}

/** Status pill badge label by state. */
export function pillLabel(state: AutomationCardState): string {
  switch (state) {
    case "running":
      return "running";
    case "invalid":
      return "invalid";
    case "disabled":
      return "disabled";
    default:
      return "enabled";
  }
}

/** Status pill badge color classes by state. */
export function pillClass(state: AutomationCardState): string {
  const base = "text-[10px] rounded px-1.5 py-0.5 font-medium ";
  switch (state) {
    case "running":
      return base + "bg-[rgba(234,179,8,0.16)] text-[#fcd34d]";
    case "invalid":
      return base + "bg-[rgba(239,68,68,0.14)] text-[#fca5a5]";
    case "disabled":
      return base + "bg-[var(--bg-subtle,rgba(0,0,0,0.06))] text-[var(--text-muted)]";
    default:
      return base + "bg-[rgba(52,211,153,0.14)] text-[#6ee7b7]";
  }
}

/** Barber-pole stripe overlay class for a running card (empty otherwise). */
export function stripeFxClass(state: AutomationCardState): string {
  return state === "running" ? "card-stripes-fx card-stripes-running" : "";
}

/** Headless source icon (spawned automation runs). */
export const headlessSourceIcon = mdiRobotOutline;

/** Static neon glow + rim overlay classes for the selected card. */
export const GLOW_FX_CLASS = "card-glow-fx";
export const GLOW_FX_OUTER_CLASS = "card-glow-fx-outer";
export const RING_FX_CLASS = "card-ring-fx";
