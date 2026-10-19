/**
 * mcp-client · settings-body class recipes (token-only, ≥ 12 px).
 *
 * Buttons / link follow the `ui-contract.md` recipes; status pills, notices and
 * the item card come from the runtime settings kit. Kept in one place so the
 * list toolbar, rows and empty state share one set of recipes.
 * See change: retro-ux-plugin-settings-wave-2.
 */
const BTN_BASE =
  "focus-ring inline-flex items-center justify-center gap-1 rounded-md px-3 min-h-[44px] sm:min-h-[32px] text-xs font-semibold disabled:cursor-not-allowed";
/** Secondary button. */
export const BTN =
  `${BTN_BASE} border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60`;
/** Primary button — exactly one per state. */
export const BTN_PRIMARY =
  `${BTN_BASE} bg-[var(--accent-solid)] text-white hover:brightness-110 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]`;
/** Inline text-button / link recipe (`--link`). */
export const LINK =
  "focus-ring inline-flex min-h-[32px] items-center gap-1 rounded text-xs font-semibold text-[var(--link)] hover:text-[var(--link-hover)] hover:underline disabled:opacity-60";
