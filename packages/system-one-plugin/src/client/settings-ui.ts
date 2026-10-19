/**
 * system-one · settings-body class recipes (token-only, ≥ 12 px).
 *
 * Buttons follow the `ui-contract.md` recipes; pills, notices, groups, items
 * and fields come from the runtime settings kit. Danger uses the
 * `--severity-error-*` tokens.
 * See change: retro-ux-plugin-settings-wave-2.
 */
const BTN_BASE =
  "focus-ring inline-flex items-center justify-center gap-1 rounded-md px-3 min-h-[32px] max-sm:min-h-[44px] text-xs font-semibold disabled:cursor-not-allowed";
/** Secondary (neutral) button. */
export const BTN = `${BTN_BASE} border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60`;
/** Primary button. */
export const BTN_PRIMARY = `${BTN_BASE} bg-[var(--accent-solid)] text-white hover:brightness-110 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]`;
/** Danger button (destructive action). */
export const BTN_DANGER = `${BTN_BASE} border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] hover:brightness-110 disabled:opacity-60`;
/** Square icon button (chain ↑ ↓ ×). */
export const BTN_ICON =
  "focus-ring inline-grid place-items-center w-8 h-8 max-sm:w-11 max-sm:h-11 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed";
/** 12 px sub-heading inside a settings group. */
export const SUBHEAD = "m-0 text-xs font-semibold text-[var(--text-primary)]";
