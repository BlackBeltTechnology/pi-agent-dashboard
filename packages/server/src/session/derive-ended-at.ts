/**
 * Best-known end time for a session whose ending was NOT witnessed.
 *
 * A session reconstructed from disk, registered from history and immediately
 * unregistered, or concluded ended because a heartbeat / grace period expired
 * must NOT record the moment of detection as its `endedAt` — that is
 * reconstruction time, not end time. This helper is the single evidence rule
 * for all of those paths.
 *
 * Precedence (fixed): recorded last activity → transcript last-write time →
 * `startedAt`. It never returns the current time.
 *
 * Witnessed endings (an explicit end signal, a user-initiated shutdown) do NOT
 * come through here — they keep `Date.now()`.
 *
 * See change: fix-ended-session-missing-endedat.
 */
import { statSync } from "node:fs";

/**
 * Read the transcript's mtime. Returns `undefined` on stat failure (missing or
 * unreadable file) so the caller falls through to `startedAt`.
 *
 * Single stat path: `session-scanner` seeds `lastActivityAt`/`lastSettledAt`
 * from this same function.
 * See change: session-card-last-activity-badge.
 */
export function readJsonlMtime(sessionFile: string): number | undefined {
  try {
    return statSync(sessionFile).mtimeMs;
  } catch {
    return undefined;
  }
}

/** The evidence a session carries about when it was last alive. */
export interface EndedAtEvidence {
  lastActivityAt?: number;
  sessionFile?: string;
  startedAt: number;
}

/** Signature of the derivation, so callers can inject a test double. */
export type EndedAtDeriver = (evidence: EndedAtEvidence) => number;

export function deriveEndedAt(evidence: EndedAtEvidence): number {
  if (typeof evidence.lastActivityAt === "number") return evidence.lastActivityAt;
  if (evidence.sessionFile) {
    const mtime = readJsonlMtime(evidence.sessionFile);
    if (mtime !== undefined) return mtime;
  }
  // NOTE: `extractTimestamp` yields `Date.now()` for an unparseable session
  // filename, so this fallback can itself be reconstruction time. Known hole,
  // tracked in the change's follow-up tasks. See design.md D2a.
  return evidence.startedAt;
}
