/**
 * ComposerDockRow — one Processes-lane row of the composer dock.
 *
 * Shared by core rows (commands, background processes) and every
 * `composer-dock-process-group` contribution, so all rows have the same
 * 32 px height, icon box, truncation and action target sizes.
 *
 * - Action targets: the actions cluster forces `min 24×24` (`min 44×44` below
 *   the `md` breakpoint = phone width) onto every `button`, `a` and
 *   `[role=button]` inside it, so a contribution passing a 16 px icon button
 *   still gets a usable target. Class literals are Tailwind-scanned (this
 *   package is @source-scanned).
 * - Elapsed: rendered from `startedAt` by `DockRowElapsed`, a leaf that owns
 *   its 1 s tick (the row and its siblings never re-render on a tick) and sits
 *   outside every live region. When `decouple-plugins-from-core` ships
 *   `ui:elapsed-badge`, switch the leaf to it — no caller changes.
 *
 * - Title: a plain truncating `span`; with `onTitleActivate` it is a `button` named by
 *   `titleLabel` (falls back to `title`) that keeps the truncation (e.g. "open this file").
 *
 * See change: add-composer-dock (D11).
 * See change: composer-dock-collapse-and-file-open (D6).
 */
import { type ReactNode, useEffect, useState } from "react";

export interface ComposerDockRowProps {
  /** Leading icon; rendered in a fixed 16 px box. */
  icon: ReactNode;
  /** Primary label (name / command). Truncates; full text in the tooltip. */
  title: string;
  /** Secondary text (task / path). Truncates; full text in the tooltip. */
  detail?: string;
  /** Short trailing facts (e.g. `scout · 3 steps`). Never truncated. */
  meta?: ReactNode;
  /** Epoch ms the work started; renders live elapsed time. Omit for none (e.g. pending). */
  startedAt?: number;
  /** Row actions (Open / Kill / Show …). Target sizes are enforced by the row. */
  actions?: ReactNode;
  /** Makes the title a button that calls this (e.g. open the file). Omit for a plain title. */
  onTitleActivate?: () => void;
  /** Accessible name of the activatable title; defaults to `title`. Ignored without `onTitleActivate`. */
  titleLabel?: string;
}

const ACTION_TARGETS = [
  "[&_button]:min-h-6 [&_button]:min-w-6 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11",
  "[&_a]:min-h-6 [&_a]:min-w-6 max-md:[&_a]:min-h-11 max-md:[&_a]:min-w-11",
  "[&_[role=button]]:min-h-6 [&_[role=button]]:min-w-6 max-md:[&_[role=button]]:min-h-11 max-md:[&_[role=button]]:min-w-11",
  // Centre the glyph inside the enlarged target.
  "[&_button]:inline-flex [&_button]:items-center [&_button]:justify-center [&_a]:inline-flex [&_a]:items-center [&_a]:justify-center",
].join(" ");

/** `5s` · `1m 03s` · `1h 02m`. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Leaf: owns the 1 s tick so nothing above it re-renders. No `aria-live`. */
function DockRowElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <span
      data-testid="composer-dock-row-elapsed"
      className="shrink-0 whitespace-nowrap tabular-nums text-[var(--text-secondary)]"
    >
      {formatElapsed(now - startedAt)}
    </span>
  );
}

export function ComposerDockRow({ icon, title, detail, meta, startedAt, actions, onTitleActivate, titleLabel }: ComposerDockRowProps) {
  return (
    <div
      data-testid="composer-dock-row"
      className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md pl-1.5 pr-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
    >
      <span
        aria-hidden="true"
        className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-secondary)] [&>svg]:h-3.5 [&>svg]:w-3.5"
      >
        {icon}
      </span>
      {onTitleActivate ? (
        <button
          type="button"
          data-testid="composer-dock-row-title"
          title={title}
          aria-label={titleLabel ?? title}
          onClick={onTitleActivate}
          className="min-h-6 min-w-0 shrink truncate rounded text-left font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] max-md:min-h-11"
        >
          {title}
        </button>
      ) : (
        <span data-testid="composer-dock-row-title" title={title} className="min-w-0 shrink truncate font-semibold">
          {title}
        </span>
      )}
      {detail !== undefined && (
        <span
          data-testid="composer-dock-row-detail"
          title={detail}
          className="min-w-0 flex-1 truncate text-[var(--text-secondary)]"
        >
          {detail}
        </span>
      )}
      {meta !== undefined && (
        <span data-testid="composer-dock-row-meta" className="shrink-0 whitespace-nowrap text-[var(--text-secondary)]">
          {meta}
        </span>
      )}
      {startedAt !== undefined && <DockRowElapsed startedAt={startedAt} />}
      {actions !== undefined && (
        <span
          data-testid="composer-dock-row-actions"
          className={`ml-auto flex shrink-0 items-center gap-1 ${ACTION_TARGETS}`}
        >
          {actions}
        </span>
      )}
    </div>
  );
}
