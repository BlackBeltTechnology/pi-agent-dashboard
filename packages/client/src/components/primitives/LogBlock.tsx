/**
 * LogBlock — the shared monospace log/stderr inset panel.
 *
 * One primitive for every "show a log" surface: spawn `stderr` (collapsible,
 * closed by default) and the `FlowAgentCard` code-node log preview (`preview`
 * mode — last N lines, mono, bounded height). A labelled header carries a copy
 * control (always copies the FULL text, regardless of the collapsed/preview
 * view) and, when `collapsible`, a collapse/expand chevron.
 *
 * See change: redesign-directory-card (inline-message-log-primitives spec).
 */
import { mdiChevronDown, mdiChevronUp, mdiContentCopy } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CopyButton } from "./CopyButton.js";

interface Props {
  /** Uppercase header label (e.g. "Pi stderr", "Program log"). */
  label: string;
  /** Full log text. Empty / whitespace-only → the block renders nothing. */
  text: string;
  /** Show a collapse/expand toggle; closed by default unless `defaultOpen`. */
  collapsible?: boolean;
  /** Initial open state for a collapsible block. Ignored in `preview` mode. */
  defaultOpen?: boolean;
  /**
   * Preview mode: always shows only the last `previewLines` lines with copy +
   * an expand toggle that reveals the full body.
   */
  preview?: boolean;
  /** Lines shown in `preview` mode before expansion. Default 3. */
  previewLines?: number;
  /** Max body height (Tailwind class). Default `max-h-32`. */
  maxHeightClass?: string;
  /** Copy glyph override (mdi path). Defaults to `mdiContentCopy`. */
  copyIcon?: string;
}

export function LogBlock({
  label,
  text,
  collapsible = false,
  defaultOpen = false,
  preview = false,
  previewLines = 3,
  maxHeightClass = "max-h-32",
  copyIcon = mdiContentCopy,
}: Props) {
  const hasToggle = collapsible || preview;
  const [open, setOpen] = useState(collapsible ? defaultOpen : false);

  // Empty / whitespace-only logs render nothing.
  if (text.trim().length === 0) return null;

  // What the body shows: preview (unexpanded) → last N lines; otherwise full.
  const showFull = !preview || open;
  const bodyText = showFull
    ? text
    : text.split("\n").slice(-previewLines).join("\n");
  // Collapsible (non-preview) hides the body entirely until opened.
  const bodyVisible = preview ? true : collapsible ? open : true;

  return (
    <div
      data-testid="log-block"
      className="mt-2 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden"
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--border-primary)] text-[9.5px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
        <span>{label}</span>
        <span className="flex-1" />
        <CopyButton
          getText={() => text}
          icon={<Icon path={copyIcon} size={0.55} />}
          title={i18nT("common.copy", undefined, "Copy")}
          testId="log-block-copy"
        />
        {hasToggle && (
          <button
            type="button"
            data-testid="log-block-toggle"
            onClick={() => setOpen((v) => !v)}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
            title={open ? i18nT("common.collapse", undefined, "Collapse") : i18nT("common.expand", undefined, "Expand")}
            aria-expanded={open}
          >
            <Icon path={open ? mdiChevronUp : mdiChevronDown} size={0.6} />
          </button>
        )}
      </div>
      {bodyVisible && (
        <pre
          data-testid="log-block-body"
          className={`m-0 px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words font-mono overflow-auto ${maxHeightClass}`}
        >
          {bodyText}
        </pre>
      )}
    </div>
  );
}
