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
  /**
   * `user` variant: remove ✕ inside the editable strip.
   * `filter` variant (user tone only): destructive global-delete ✕ rendered as
   * a sibling of the toggle button (never nested). See change:
   * sidebar-tag-collapse-and-delete.
   */
  onRemove?: () => void;
}

const baseClass =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight whitespace-nowrap font-[inherit]";

/** Inline style for a colorized (user-tone) chip, hashed from the label. */
function userStyle(label: string): React.CSSProperties {
  const c = tagColor(label);
  return { color: c.text, borderColor: c.border, backgroundColor: c.bg };
}

const NO_RING = { ringClass: "", ringStyle: undefined } as const;

/**
 * Selection ring for a `filter` chip, resolved for its two possible hosts: the
 * toggle alone, or the wrapper enclosing the toggle + the destructive ✕ (so the
 * ✕ stays inside the selected unit). Tailwind can't emit a class for a runtime
 * hash color, so a colorized chip carries the ring color inline from its own
 * palette entry; `exec` chips keep `outline-current`, which already resolves to
 * their intended muted color. See change: fix-selected-tag-chip-ring.
 */
function selectionRing(on: boolean, colorized: boolean, label: string, hostIsWrapper: boolean) {
  if (!on) return { toggle: NO_RING, wrapper: NO_RING };
  const ring = {
    ringClass: `outline outline-1 outline-offset-1 ${colorized ? "" : "outline-current"}`,
    ringStyle: colorized ? ({ outlineColor: tagColor(label).text } as React.CSSProperties) : undefined,
  };
  return hostIsWrapper ? { toggle: NO_RING, wrapper: ring } : { toggle: ring, wrapper: NO_RING };
}

export function TagChip({ label, variant, tone = "user", selected, onToggle, onRemove }: TagChipProps) {
  const colorized = variant === "user" || (variant === "filter" && tone === "user");
  const display = colorized ? `#${label}` : label;

  const style = colorized ? userStyle(label) : undefined;
  const execClass = colorized
    ? ""
    : "border-dashed border-[var(--border-secondary)] bg-transparent text-[var(--text-tertiary)]";
  const ring = selectionRing(variant === "filter" && !!selected, colorized, label, !!onRemove);

  if (variant === "filter") {
    const toggleBtn = (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!!selected}
        aria-label={`Filter by ${tone === "exec" ? "phase" : "tag"} ${label}`}
        style={{ ...style, ...ring.toggle.ringStyle }}
        className={`${baseClass} ${ring.toggle.ringClass} ${execClass} cursor-pointer`}
      >
        {display}
      </button>
    );
    // Destructive global-delete ✕ (user-tone filter chips only). Wrap the
    // toggle + ✕ in a single inline-flex unit so the ✕ never wraps to its own
    // line, and re-home the `selected` ring onto the wrapper. The ✕ is a true
    // sibling <button> — its click does NOT bubble to the toggle (no
    // stopPropagation needed). See change: sidebar-tag-collapse-and-delete.
    if (onRemove && tone === "user") {
      return (
        <span style={ring.wrapper.ringStyle} className={`inline-flex items-center rounded-full ${ring.wrapper.ringClass}`}>
          {toggleBtn}
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove tag ${label} from all sessions`}
            className="ml-0.5 flex min-h-[24px] min-w-[24px] cursor-pointer items-center justify-center rounded-full text-current opacity-50 hover:opacity-100 hover:text-[var(--accent-red,#f87171)] focus-ring"
          >
            ✕
          </button>
        </span>
      );
    }
    return toggleBtn;
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
