import React from "react";

/**
 * Skeleton placeholder card shown while a new session is being spawned.
 * Matches redesigned SessionCard dimensions with pulse animation loading bars.
 */
export function PlaceholderSessionCard() {
  return (
    <div
      data-testid="placeholder-session-card"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2.5 md:px-3.5 md:py-2.5 shadow-sm animate-pulse opacity-70"
    >
      {/* Row 1: status dot + name bar */}
      <div className="flex items-center gap-2 mb-1.5 md:mb-2">
        <div className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full bg-[var(--border-secondary)] shrink-0" />
        <div className="h-3.5 w-32 md:w-40 rounded-md bg-[var(--bg-surface)]" />
        {/* Time skeleton — desktop only */}
        <div className="hidden md:block h-3 w-8 rounded-md bg-[var(--bg-surface)] ml-auto" />
      </div>
      {/* Row 2: model skeleton */}
      <div className="mb-1.5 md:mb-2">
        <div className="h-3 w-24 md:w-28 rounded-md bg-[var(--bg-surface)]" />
      </div>
      {/* Row 3: activity + context + cost — desktop only */}
      <div className="hidden md:flex items-center gap-3">
        <div className="h-3 w-20 rounded-md bg-[var(--bg-surface)]" />
        <div className="h-1.5 w-20 rounded-full bg-[var(--bg-surface)] ml-auto" />
        <div className="h-3 w-9 rounded-md bg-[var(--bg-surface)]" />
      </div>
      {/* Loading text */}
      <div className="text-[10px] text-[var(--text-tertiary)] mt-1">Starting new session…</div>
    </div>
  );
}
