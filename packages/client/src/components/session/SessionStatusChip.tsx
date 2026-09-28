/**
 * The session card's status chip (desktop + mobile variants), extracted from
 * `SessionCard` so it can own the history-load ring, its show-delay and the
 * 1 s tooltip clock without re-rendering the whole card every second.
 *
 * Ring (design A, `mockups/index.html`): an absolute span rendered BEFORE the
 * icon + `StatusShapeBadge` children, so the badge (opaque, later in DOM) paints
 * on top. loading = spinning ¾ accent arc (after `REPLAY_PILL_DELAY_MS`),
 * waiting = dashed, failed = solid error ring; the latter two paint at once.
 * Tokens `--accent-text` / `--text-tertiary` / `--tint-red-fg` (not `--accent` /
 * `--status-error`, which drop below 3:1 on the selected card in nord-dark,
 * solarized-dark and tokyo-night-light) — pinned by theme-body-text-contrast.test.ts.
 * See change: show-session-history-load-state (design D6, D7).
 */
import type React from "react";
import { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type HistoryLoadPhase, SLOW_LOAD_MS } from "../../lib/replay/history-load-phase.js";
import { REPLAY_PILL_DELAY_MS } from "../../lib/replay/loading-history.js";
import { useNow } from "../../lib/time/use-now.js";

export interface SessionStatusChipProps {
  variant: "desktop" | "mobile";
  sessionId: string;
  /** Existing `"<source> — <status>"` tooltip. */
  baseTitle: string;
  /** Status colour class shared with the badge. */
  colorClass: string;
  statusShape: string;
  isSelected: boolean;
  historyPhase?: HistoryLoadPhase;
  historyStartedAt?: number;
  /** Source icon + `StatusShapeBadge`. */
  children: React.ReactNode;
}

const RING_BASE = "pointer-events-none absolute -inset-[3px] rounded-full border-2";
const RING_CLASS: Record<Exclude<HistoryLoadPhase, "idle">, string> = {
  loading: `${RING_BASE} border-[var(--accent-text)] border-t-transparent animate-spin motion-reduce:animate-none`,
  waiting: `${RING_BASE} border-dashed border-[var(--text-tertiary)]`,
  failed: `${RING_BASE} border-[var(--tint-red-fg)]`,
};

/** Static (digit-free) ring text for screen readers. */
function staticRingText(phase: Exclude<HistoryLoadPhase, "idle">): string {
  if (phase === "loading") return i18nT("status.historyLoading", undefined, "Loading history…");
  if (phase === "waiting") return i18nT("status.historyWaiting", undefined, "Waiting for connection");
  return i18nT("status.historyFailed", undefined, "Couldn't load history");
}

/** Tooltip ring text: static, or "Still loading history · Ns" past `SLOW_LOAD_MS`. */
function ringTooltipText(phase: Exclude<HistoryLoadPhase, "idle">, startedAt: number | undefined, now: number): string {
  const elapsed = phase === "loading" && startedAt !== undefined ? now - startedAt : 0;
  if (elapsed < SLOW_LOAD_MS) return staticRingText(phase);
  return `${i18nT("status.historyStillLoading", undefined, "Still loading history")} · ${Math.floor(elapsed / 1000)}s`;
}

export function SessionStatusChip({
  variant,
  sessionId,
  baseTitle,
  colorClass,
  statusShape,
  isSelected,
  historyPhase = "idle",
  historyStartedAt,
  children,
}: SessionStatusChipProps) {
  const loading = historyPhase === "loading";
  // Show-delay for the arc only: a fast load never paints it. Keyed on the load
  // ATTEMPT (session + startedAt), so a Retry (loading → loading, new clock)
  // re-runs the delay; the derived compare hides the arc in the very first
  // render of a new attempt, before the effect runs.
  const attemptKey = loading ? `${sessionId}:${historyStartedAt ?? ""}` : null;
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (attemptKey === null) return;
    const timer = setTimeout(() => setReadyKey(attemptKey), REPLAY_PILL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [attemptKey]);
  const arcReady = attemptKey !== null && readyKey === attemptKey;
  const now = useNow(loading);

  const ringPhase = historyPhase === "idle" || (loading && !arcReady) ? null : historyPhase;
  const title = ringPhase ? `${baseTitle} · ${ringTooltipText(ringPhase, historyStartedAt, now)}` : baseTitle;
  const srText = ringPhase ? staticRingText(ringPhase) : "";

  const className = variant === "desktop"
    ? `relative inline-flex flex-shrink-0 items-center justify-center w-4 h-4 rounded-full bg-[var(--bg-tertiary)] shadow-sm ${colorClass}`
    : `relative inline-flex flex-shrink-0 ${colorClass}`;

  return (
    <span className={className} title={title} data-testid="session-status-icon" data-status-shape={statusShape}>
      {ringPhase ? (
        <span aria-hidden="true" data-testid="session-history-ring" data-history-phase={ringPhase} className={RING_CLASS[ringPhase]} />
      ) : null}
      {children}
      {/* Live region only on the selected card so many loading cards cannot
          flood a screen reader; kept mounted while selected so changes announce. */}
      {isSelected ? (
        <span className="sr-only" role="status" data-testid="session-history-ring-text">{srText}</span>
      ) : srText ? (
        <span className="sr-only" data-testid="session-history-ring-text">{srText}</span>
      ) : null}
    </span>
  );
}
