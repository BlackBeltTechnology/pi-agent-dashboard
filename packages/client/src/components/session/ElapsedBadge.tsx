import React, { useState, useEffect } from "react";

interface Props {
  /** Epoch ms when the operation started (for live counter) */
  startedAt?: number;
  /** Duration in ms (set when complete — takes precedence over live counter) */
  duration?: number;
}

/** Format milliseconds into a human-readable elapsed string */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return "<1s";
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Small badge showing elapsed time.
 * - If `duration` is set → static display (completed)
 * - If only `startedAt` is set → live ticking counter (running)
 */
export function ElapsedBadge({ startedAt, duration }: Props) {
  const [now, setNow] = useState(Date.now);

  const isLive = duration == null && startedAt != null;

  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  if (duration != null) {
    return (
      <span className="text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
        {formatElapsed(duration)}
      </span>
    );
  }

  if (startedAt != null) {
    const elapsed = now - startedAt;
    return (
      <span className="text-[10px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
        {formatElapsed(elapsed)}…
      </span>
    );
  }

  return null;
}
