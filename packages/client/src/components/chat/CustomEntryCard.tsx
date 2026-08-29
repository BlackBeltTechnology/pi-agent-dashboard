import { mdiPuzzleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { formatMessageTime } from "../../lib/util/format.js";

interface Props {
  /** Extension-authored label — rendered verbatim, never interpreted. */
  customType: string;
  /**
   * Display body, already extracted + truncated to the last-200-lines form at
   * row creation (reducer). Rendered as PLAIN TEXT: the payload is untrusted
   * extension-authored input, so no markdown/linkification — `RawEventCard`'s
   * escape-by-`<pre>` treatment.
   */
  body: string;
  timestamp: number;
}

/**
 * Bounded generic fallback card for non-flow-event custom content
 * (pi.sendMessage custom messages + pi.appendEntry entries) — change:
 * render-inline-reasoning-and-custom-entries (design D4).
 *
 * Mirrors `RawEventCard`'s plain-text `<pre>` chrome, but the body renders
 * VISIBLE by default (the bug being fixed is invisibility) inside a modest
 * bounded-height region. Height-bounded + text-only = the card can neither
 * grow unbounded nor interpret (and be spoofed by) the payload.
 */
export function CustomEntryCard({ customType, body, timestamp }: Props) {
  return (
    <div
      className="my-1 mx-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] overflow-hidden text-xs"
      data-testid="custom-entry-card"
    >
      <div className="w-full flex items-center gap-2 px-3 py-1.5">
        <Icon path={mdiPuzzleOutline} size={0.55} className="text-cyan-400" />
        <span className="font-mono text-cyan-400 break-all">{customType}</span>
        <span className="ml-auto shrink-0 text-[var(--text-tertiary)]">
          {formatMessageTime(timestamp)}
        </span>
      </div>
      <pre className="mx-3 mb-2 px-2 pt-1 pb-1 rounded bg-[var(--bg-secondary)] overflow-y-auto overflow-x-auto max-h-[240px] text-[var(--text-secondary)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        {body}
      </pre>
    </div>
  );
}
