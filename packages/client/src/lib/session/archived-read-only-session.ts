/**
 * Read-only archived open (`/session/:id?archived=1`): the session stays OUT of
 * the live `sessions` Map, so every consumer that needs a row (header, editor
 * pane cwd) resolves it through `viewedSession`.
 * See change: archive-sessions-lazy-load, fix-archived-session-view-header-and-stale-artifact-tab (D1).
 */
import type { ArchivedSessionSummary } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Synthesize a header-only `DashboardSession` from an archived summary row. It
 * must NEVER be written back into the live `sessions` Map.
 */
export function archivedSummaryToSession(item: ArchivedSessionSummary): DashboardSession {
  return {
    id: item.id,
    cwd: item.cwd,
    name: item.name,
    firstMessage: item.firstMessage,
    source: "tui",
    status: "ended",
    startedAt: item.endedAt,
    endedAt: item.endedAt,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    sessionFile: item.sessionFile,
    gitWorktree: item.gitWorktree,
    // Origin + retained completeness carried through, so a read-only open of an
    // ARCHIVED REMOTE session still distinguishes a truncated transfer from a
    // whole one. See change: serve-retained-remote-transcripts (task 2.2).
    originDeviceId: item.originDeviceId,
    retainedTranscript: item.retainedTranscript,
  };
}

/** Live row first, else the synthesized row for the archived-read-only id. */
export function viewedSession(
  id: string | undefined,
  sessions: ReadonlyMap<string, DashboardSession>,
  archivedReadOnlyId: string | undefined,
  summaries: ReadonlyMap<string, ArchivedSessionSummary>,
): DashboardSession | undefined {
  if (!id) return undefined;
  const live = sessions.get(id);
  if (live) return live;
  if (id !== archivedReadOnlyId) return undefined;
  const summary = summaries.get(id);
  return summary ? archivedSummaryToSession(summary) : undefined;
}
