import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Skeleton placeholder card shown while a new session is being spawned.
 * Matches SessionCard dimensions with pulse animation loading bars.
 */
export function PlaceholderSessionCard() {
  return (
    <div
      data-testid="placeholder-session-card"
      className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-3 animate-pulse"
    >
      {/* Status dot + name bar */}
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
        <div className="h-3 w-32 rounded bg-[var(--text-muted)]/30" />
      </div>
      {/* Subtitle bar */}
      <div className="h-2.5 w-24 rounded bg-[var(--text-muted)]/20 mb-2" />
      {/* Loading text */}
      <div className="text-[10px] text-[var(--text-tertiary)]">{i18nT("session.startingNewSession", undefined, "Starting new session…")}</div>
    </div>
  );
}
