/**
 * Tone → class helpers. Total and prototype-safe: any non-UiTone value yields
 * "" / undefined. Maps hold complete literals (Tailwind scans them); a tone is
 * never interpolated. See change: colorize-actions-menus.
 */
import { isUiTone, type UiTone } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";

const ICON: Record<UiTone, string> = {
  go: "text-[var(--accent-green-text)]",
  create: "text-[var(--accent-blue-text)]",
  caution: "text-[var(--accent-orange-text)]",
  danger: "text-[var(--accent-red-text)]",
};

const DANGER_ROW =
  "hover:bg-[var(--tint-red-bg)] focus:bg-[var(--tint-red-bg)] hover:text-[var(--accent-red-text)] focus:text-[var(--accent-red-text)]";

export function toneIconClass(tone: unknown, opts: { disabled: boolean }): string {
  return isUiTone(tone) && !opts.disabled ? ICON[tone] : "";
}

export function toneRowClass(tone: unknown, opts: { disabled: boolean }): string {
  return tone === "danger" && !opts.disabled ? DANGER_ROW : "";
}

export function toneAttr(tone: unknown): UiTone | undefined {
  return isUiTone(tone) ? tone : undefined;
}
