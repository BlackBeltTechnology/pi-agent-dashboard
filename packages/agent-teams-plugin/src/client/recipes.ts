/**
 * String-free class recipes and the time formatter shared by every lazy module
 * (Team view, mail card, tool renderers) without pulling any module's string table
 * into another's chunk. Tokens by name only; ≥ 44 px targets below `sm`.
 * Agent text goes through `TEXT` (plain React text, `pre-wrap`, `overflow-wrap:anywhere`).
 * See change: add-agent-teams-ui.
 */
export const BTN =
  "focus-ring inline-flex items-center justify-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--text-secondary)]";
export const BTN_DANGER = "focus-ring inline-flex items-center justify-center gap-1 rounded-md border px-3 min-h-[44px] sm:min-h-[32px] text-[12px] font-semibold tint-action-red disabled:cursor-not-allowed";
export const CHIP = "inline-flex max-w-full items-center rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] [overflow-wrap:anywhere]";
export const LINKBTN = "focus-ring inline-flex items-center rounded text-left text-[12px] text-[var(--link)] hover:text-[var(--link-hover)] hover:underline min-h-[44px] sm:min-h-[24px] [overflow-wrap:anywhere]";
export const SECTION_H = "text-[12px] font-semibold text-[var(--text-secondary)]";
export const TEXT = "whitespace-pre-wrap [overflow-wrap:anywhere]";

/** `HH:MM` in the viewer's locale, or `undefined` for a missing, NaN or out-of-range timestamp (never "Invalid Date"). */
export function formatTime(ms: unknown): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

