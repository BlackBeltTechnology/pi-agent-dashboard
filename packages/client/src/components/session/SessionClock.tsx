/**
 * Labelled session clock for the header meta line. Owns its own 1 s interval so
 * the ticking re-renders THIS leaf only, never the whole `SessionHeader`.
 *
 * Live: `running <duration>`; ended: `ended · ran <lastActivityAt − startedAt>`
 * (plain `ended` when `lastActivityAt` is absent). Both are clamped at 0.
 * Ended sessions do not tick.
 *
 * See change: reorganize-session-header.
 */
import { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

interface Props {
  startedAt: number;
  lastActivityAt?: number;
  /** True once the session has ended (status === "ended"). */
  ended: boolean;
  className?: string;
}

export function SessionClock({ startedAt, lastActivityAt, ended, className }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (ended) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ended]);

  let text: string;
  if (ended) {
    if (lastActivityAt === undefined) {
      text = i18nT("session.clockEnded", undefined, "ended");
    } else {
      // A finished run does not need second precision once it passed a minute.
      const duration = formatDuration(Math.max(0, lastActivityAt - startedAt)).replace(/ \d+s$/, "");
      text = i18nT("session.clockEndedRan", { duration }, "ended · ran {duration}");
    }
  } else {
    const duration = formatDuration(Math.max(0, now - startedAt));
    text = i18nT("session.clockRunning", { duration }, "running {duration}");
  }

  return (
    <span className={className} data-testid="session-clock">
      {text}
    </span>
  );
}
