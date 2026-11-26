/**
 * Snapshot diffing and the throttled announcer behind the Team view's polite
 * live region (design D10; task 7.5). `diffSnapshots` turns two consecutive
 * snapshots into structured events (member status, task completed, team closed);
 * `createAnnouncer` emits at most ONE merged summary per 4 s (leading, then a
 * trailing flush). Events carry member names, task ids and statuses only —
 * never mail text, task titles or the team name. The view translates a summary
 * with `announcementLines` + its own string table. No React.
 * See change: add-agent-teams-ui.
 */
import type { TeamUiSnapshot } from "../shared/ui-protocol.js";
import { memberStatusEntry } from "./status-map.js";

export const ANNOUNCE_INTERVAL_MS = 4000;

export type AnnounceEvent =
  | { kind: "member"; name: string; status: string }
  | { kind: "task_completed"; id: string }
  | { kind: "team_closed" };

export interface AnnounceSummary {
  /** Latest status per member that changed inside the window. */
  members: Array<{ name: string; status: string }>;
  tasksCompleted: string[];
  teamClosed: boolean;
}

/** Events between two snapshots; the first snapshot ever loaded is the baseline (no events). */
export function diffSnapshots(prev: TeamUiSnapshot | undefined, next: TeamUiSnapshot): AnnounceEvent[] {
  if (!prev) return [];
  const events: AnnounceEvent[] = [];
  const before = new Map(prev.members.map((m) => [m.name, m.status] as const));
  for (const m of next.members) if (before.get(m.name) !== m.status) events.push({ kind: "member", name: m.name, status: m.status });
  const wasDone = new Set(prev.tasks.filter((t) => t.status === "completed").map((t) => t.id));
  for (const t of next.tasks) if (t.status === "completed" && !wasDone.has(t.id)) events.push({ kind: "task_completed", id: t.id });
  if (next.status === "closed" && prev.status !== "closed") events.push({ kind: "team_closed" });
  return events;
}

/** Fold one event into a pending summary: latest status per member, task ids once, close flag. */
function mergeEvent(summary: AnnounceSummary, e: AnnounceEvent): void {
  if (e.kind === "member") {
    const at = summary.members.findIndex((m) => m.name === e.name);
    if (at >= 0) summary.members[at] = { name: e.name, status: e.status };
    else summary.members.push({ name: e.name, status: e.status });
  } else if (e.kind === "task_completed") {
    if (!summary.tasksCompleted.includes(e.id)) summary.tasksCompleted.push(e.id);
  } else summary.teamClosed = true;
}

export interface Announcer {
  push(events: readonly AnnounceEvent[]): void;
  dispose(): void;
}

/** Throttle: emit when ≥ `ANNOUNCE_INTERVAL_MS` passed since the last emission, else defer and flush on a timer. */
export function createAnnouncer(emit: (summary: AnnounceSummary) => void, intervalMs: number = ANNOUNCE_INTERVAL_MS): Announcer {
  let pending: AnnounceSummary | undefined;
  let lastEmitAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): void => {
    clear();
    if (!pending) return;
    const summary = pending;
    pending = undefined;
    lastEmitAt = Date.now();
    emit(summary);
  };

  return {
    push(events) {
      if (events.length === 0) return;
      pending ??= { members: [], tasksCompleted: [], teamClosed: false };
      for (const e of events) mergeEvent(pending, e);
      const wait = lastEmitAt + intervalMs - Date.now();
      if (wait <= 0) flush();
      else if (timer === undefined) timer = setTimeout(flush, wait);
    },
    dispose() {
      clear();
      pending = undefined;
    },
  };
}

export interface AnnouncementLine {
  /** Key in the lazy view's table (`announce.member.<status>`, `announce.task_completed`, `announce.team_closed`). */
  key: string;
  vars?: Record<string, string>;
}

/** A summary as i18n keys + vars; an unknown member status uses `announce.member.unknown`. */
export function announcementLines(summary: AnnounceSummary): AnnouncementLine[] {
  return [
    ...summary.members.map((m) => ({ key: memberStatusEntry(m.status).sentenceKey, vars: { name: m.name } })),
    ...summary.tasksCompleted.map((id) => ({ key: "announce.task_completed", vars: { id } })),
    ...(summary.teamClosed ? [{ key: "announce.team_closed" }] : []),
  ];
}
