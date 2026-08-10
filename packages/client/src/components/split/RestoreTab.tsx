/**
 * Rotated vertical restore tab — the shared collapse/restore idiom for the
 * collapsed chat/editor pane peeks and the collapsed session rail. In-flow
 * (Fluent SplitView "inline"): a flex sibling that PUSHES content aside, never
 * an overlay, so it can never clip a narrow pane. This is the structural fix
 * for the maximized-window overlap bug — the tab lives in the flex flow, so it
 * has no way to float over a pane's content.
 *
 * See change: redesign-split-layout-controls.
 */

interface RestoreTabProps {
  /** Which edge the tab anchors to (drives the border side). */
  side: "left" | "right";
  /** Upright caption text (rotated by the vertical writing mode). */
  label: string;
  /** Directional chevron glyph, kept horizontal inside the rotated tab. */
  chevron: string;
  onClick: () => void;
  title: string;
  "data-testid"?: string;
}

export function RestoreTab({ side, label, chevron, onClick, title, "data-testid": testId }: RestoreTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid={testId}
      style={{ writingMode: "vertical-rl" }}
      className={`flex w-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 bg-[var(--bg-secondary)] text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-primary)] ${
        side === "left"
          ? "border-r border-[var(--border-primary)]"
          : "border-l border-[var(--border-primary)]"
      }`}
    >
      <span className="text-[13px] [writing-mode:horizontal-tb]">{chevron}</span>
      {label}
    </button>
  );
}
