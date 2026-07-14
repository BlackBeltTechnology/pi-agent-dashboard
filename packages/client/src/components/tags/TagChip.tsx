/**
 * Shared tag chip primitive. Three variants:
 *   - `user`  — colorized (hash → palette), optional remove ✕ (editable strip).
 *   - `exec`  — dashed + muted + read-only phase chip (lock glyph).
 *   - `filter` — selectable filter chip with a `sel` ring; `tone` picks the
 *     colorized (user) vs dashed (phase) look so one component serves both
 *     sidebar groups.
 *
 * Interactive controls (remove, filter toggle) are real <button>s — keyboard
 * operable with accessible names. See change: add-session-tags.
 */

import { tagColor } from "@blackbelt-technology/pi-dashboard-shared/tags.js";
import type React from "react";

export type TagChipVariant = "user" | "exec" | "filter";
export type TagChipTone = "user" | "exec";

interface TagChipProps {
  /** Tag value (user tag or phase name). Already normalized for user tags. */
  label: string;
  variant: TagChipVariant;
  /** For `filter`: colorized (user tag) or dashed (phase). Ignored otherwise. */
  tone?: TagChipTone;
  /** For `filter`: selection state. */
  selected?: boolean;
  /** For `filter`: toggle handler. */
  onToggle?: () => void;
  /** For `user`: remove handler (renders a ✕ button). */
  onRemove?: () => void;
}

const baseClass =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight whitespace-nowrap font-[inherit]";

/** Inline style for a colorized (user-tone) chip, hashed from the label. */
function userStyle(label: string): React.CSSProperties {
  const c = tagColor(label);
  return { color: c.text, borderColor: c.border, backgroundColor: c.bg };
}

export function TagChip({ label, variant, tone = "user", selected, onToggle, onRemove }: TagChipProps) {
  const colorized = variant === "user" || (variant === "filter" && tone === "user");
  const display = colorized ? `#${label}` : label;

  const style = colorized ? userStyle(label) : undefined;
  const execClass = colorized
    ? ""
    : "border-dashed border-[var(--border-secondary)] bg-transparent text-[var(--text-tertiary)]";
  const selRing = variant === "filter" && selected ? "outline outline-2 outline-offset-1 outline-current" : "";

  if (variant === "filter") {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!!selected}
        aria-label={`Filter by ${tone === "exec" ? "phase" : "tag"} ${label}`}
        style={style}
        className={`${baseClass} ${execClass} ${selRing} cursor-pointer`}
      >
        {display}
      </button>
    );
  }

  if (variant === "exec") {
    return (
      <span style={style} className={`${baseClass} ${execClass}`}>
        {display}
        <span aria-hidden className="text-[10px] opacity-60">
          🔒
        </span>
      </span>
    );
  }

  // variant === "user"
  return (
    <span style={style} className={baseClass}>
      {display}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${label}`}
          className="ml-0.5 cursor-pointer text-current opacity-50 hover:opacity-100 hover:text-[var(--accent-red,#f87171)]"
        >
          ✕
        </button>
      ) : null}
    </span>
  );
}
