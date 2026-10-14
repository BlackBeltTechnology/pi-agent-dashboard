/**
 * Class recipes shared by the `/pair` landing screens (QR + request mode).
 * Theme tokens only — no palette class, hex or `rgba(` literal.
 *
 * See change: add-lan-knock-pairing.
 */

const BASE =
  "focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded px-4 py-2 min-h-[44px] sm:min-h-[36px] text-sm font-medium cursor-pointer disabled:cursor-not-allowed";
const DISABLED = "disabled:border disabled:border-[var(--border-secondary)] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]";

/** The screen's one primary action. */
export const LANDING_PRIMARY = `${BASE} bg-[var(--accent-solid)] text-white ${DISABLED}`;
/** A recovery action that is not the screen's primary one. */
export const LANDING_SECONDARY = `${BASE} border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] ${DISABLED}`;

const CALLOUT = "flex items-start gap-2 rounded border p-3 text-sm";
export const CALLOUT_WARNING = `${CALLOUT} border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]`;
export const CALLOUT_INFO = `${CALLOUT} border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]`;
export const CALLOUT_ERROR = `${CALLOUT} border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]`;
export const CALLOUT_SUCCESS = `${CALLOUT} border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]`;
