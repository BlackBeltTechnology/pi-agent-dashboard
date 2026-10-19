/**
 * Token-only button recipes shared by `BlackholeSettings` and `ChainEditor`
 * (`ui-contract.md` button recipes): 32 px targets, 12 px text, focus ring.
 * Presentation only — no behaviour lives here.
 *
 * See change: retro-ux-plugin-settings-wave-2.
 */
const BASE =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";

/** Secondary: bordered, neutral surface. */
export const BTN_SECONDARY = `${BASE} border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`;

/** Ghost: no border until hovered. */
export const BTN_GHOST = `${BASE} text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`;

/** Square 32 px icon button (ghost). */
export const BTN_ICON = `${BASE} min-w-[32px] justify-center px-0 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]`;

/** Square 32 px icon button for a destructive action (danger ghost). */
export const BTN_ICON_DANGER = `${BASE} min-w-[32px] justify-center px-0 text-[var(--severity-error-fg)] hover:bg-[var(--severity-error-bg)]`;
