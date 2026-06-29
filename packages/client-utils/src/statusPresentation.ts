/**
 * statusPresentation — shared status vocabulary that expresses each state via a
 * semantic `--status-*` token AND a mandatory non-hue channel (a glyph), so
 * status is never conveyed by color alone.
 *
 * Covered surfaces (composer `ArtifactChip`, OpenSpec board state pill) consume
 * this helper instead of re-rolling their own color-only maps. The glyph keeps
 * "done" distinguishable from "todo" in grayscale; `statusAriaLabel` names the
 * item + state for screen readers.
 *
 * Rule: WCAG 2.2 §1.4.1; DRY; H4.
 * See change: extend-client-utils-state-feedback-primitives.
 */

export type StatusKind = "done" | "current" | "todo" | "error";

export interface StatusPresentation {
  /** Non-hue channel — a shape/glyph distinct per state, color-independent. */
  glyph: string;
  /** Semantic color token reference (CSS var). */
  tokenVar: string;
  /** Human-readable state label, e.g. "done". */
  label: string;
}

const STATUS_MAP: Record<StatusKind, StatusPresentation> = {
  done: { glyph: "✓", tokenVar: "var(--status-idle)", label: "done" },
  current: { glyph: "▸", tokenVar: "var(--status-working)", label: "current" },
  todo: { glyph: "○", tokenVar: "var(--text-muted)", label: "todo" },
  error: { glyph: "✕", tokenVar: "var(--status-error)", label: "error" },
};

export function statusPresentation(kind: StatusKind): StatusPresentation {
  return STATUS_MAP[kind];
}

/**
 * Accessible name combining the item name and its state, e.g. "Proposal, done".
 * Pass `label` to localize the status word; defaults to the English label so
 * non-i18n callers stay correct.
 */
export function statusAriaLabel(
  name: string,
  kind: StatusKind,
  label: string = STATUS_MAP[kind].label,
): string {
  return `${name}, ${label}`;
}
