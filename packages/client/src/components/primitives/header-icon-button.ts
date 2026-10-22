/**
 * Shared recipe for the sidebar-header icon buttons (row-1 Discord, Appearance,
 * Focus, Settings; row-2 filter funnel). 28 px box, 18 px glyph, `--bg-hover`
 * fill on hover/open, selected-chip look while pressed. Core-only: plugins do
 * not use it. See change: polish-sidebar-header-controls (D1).
 */
export const HEADER_ICON_BTN =
  "focus-ring relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] aria-expanded:bg-[var(--bg-hover)] aria-expanded:text-[var(--text-primary)] aria-pressed:border aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed";

/** `@mdi/react` size for header icon glyphs: renders 1.125rem (18 px). */
export const HEADER_ICON_SIZE = 0.75;
