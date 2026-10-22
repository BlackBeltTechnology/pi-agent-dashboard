/**
 * `useDockDiff` — the composer dock's Changes-lane data: `useSessionDiff`
 * behind a coalescing scheduler, plus the derived header model.
 *
 * Refresh triggers (design D5):
 *   - the first load for a session (immediate);
 *   - the working → not-working edge (`working` is `isComposerWorking`);
 *   - a `dirtyCount` change while idle (mid-turn flapping is ignored: the falling edge covers it);
 *   - lane expand (`refreshOnExpand`) and Retry (`retry`).
 *
 * Scheduling: at most one request in flight. A trigger during a request, or
 * within the window of the last start, sets ONE pending refetch that runs once
 * the request has settled and the window has passed; triggers are never
 * dropped, so the request rate is bounded without losing a turn-end refresh.
 * Turn-end and dirty-count triggers also wait `DOCK_DIFF_SETTLE_MS` before
 * their request starts, so the two signals a turn end produces in the same
 * second (status → idle, git status update) become one request, not two.
 *
 * Back-off (task 4.3): when a request takes longer than `DOCK_DIFF_SLOW_MS`
 * the window doubles for each consecutive slow request (capped), and a fast
 * request resets it. Measured need and numbers: design.md Risks.
 *
 * The header count and totals cover one set: the in-cwd, session-owned entries.
 * Out-of-cwd entries (`previewable: false`) are listed apart, without a diff
 * link and outside the count. The server caps owned files at `MAX_FILES = 200`
 * with no truncation flag, so exactly 200 renders as `200+`. Without server
 * totals the sum of per-file counts is used; with neither, totals are `null`
 * and only the count shows. Client turn deltas are never used.
 *
 * See change: add-composer-dock (tasks 4.2, 4.3; design D5).
 */
import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { logRejection } from "../lib/report-error.js";
import { useSessionDiff } from "./useSessionDiff.js";

/** Minimum gap between two request starts. */
export const DOCK_DIFF_WINDOW_MS = 2000;
/** Wait before a turn-end / dirty-count trigger starts its request (coalesces same-second signals). */
export const DOCK_DIFF_SETTLE_MS = 1000;
/** A request slower than this doubles the window (task 4.3, p95 budget). */
export const DOCK_DIFF_SLOW_MS = 300;
/** Ceiling of the back-off window. */
export const DOCK_DIFF_MAX_WINDOW_MS = 30_000;
/** Server cap on owned files (`MAX_FILES`, `packages/server/src/session/session-diff.ts`). */
export const DOCK_DIFF_SERVER_CAP = 200;

export interface DockDiffInput {
  /** Bound session; `undefined` → nothing is fetched. */
  sessionId: string | undefined;
  /** `isComposerWorking(status, retrying)`. */
  working: boolean;
  /** `session.gitStatus?.dirtyCount`. */
  dirtyCount: number | undefined;
}

export interface DockDiffTotals {
  additions: number;
  deletions: number;
}

export interface DockDiff {
  /** In-cwd, session-owned entries (the counted set). */
  files: readonly FileDiffEntry[];
  /** Out-of-cwd entries: listed without a diff link, never counted. */
  outOfCwd: readonly FileDiffEntry[];
  /** `files.length`. */
  count: number;
  /** `count` hit the server cap, so the true number may be larger (`200+`). */
  capped: boolean;
  /** Line totals over `files`; `null` without any (non-git). */
  totals: DockDiffTotals | null;
  /** Working-tree changes this session cannot claim. */
  otherChangesCount: number;
  /** A response has been received for this session. */
  loaded: boolean;
  /** The last request failed (the last good list is kept). */
  failed: boolean;
  /** Start a refetch under the coalescing rule (Retry). */
  retry: () => void;
  /** Lane expand: refetch under the coalescing rule. */
  refreshOnExpand: () => void;
}

interface Scheduler {
  gen: number;
  inFlight: boolean;
  pending: boolean;
  dueAt: number;
  lastStart: number;
  slowStreak: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const MAX_STREAK = 5;

/** Window after the last start: base, doubled per consecutive slow request, capped. */
function windowMs(streak: number): number {
  return Math.min(DOCK_DIFF_WINDOW_MS * 2 ** streak, DOCK_DIFF_MAX_WINDOW_MS);
}

function sumTotals(files: readonly FileDiffEntry[]): DockDiffTotals | null {
  let any = false;
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    if (f.additions !== undefined || f.deletions !== undefined) any = true;
    additions += f.additions ?? 0;
    deletions += f.deletions ?? 0;
  }
  return any ? { additions, deletions } : null;
}

export function useDockDiff({ sessionId, working, dirtyCount }: DockDiffInput): DockDiff {
  const { data, error, refresh } = useSessionDiff(sessionId, { auto: false });
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const sched = useRef<Scheduler>({
    gen: 0,
    inFlight: false,
    pending: false,
    dueAt: 0,
    lastStart: Number.NEGATIVE_INFINITY,
    slowStreak: 0,
    timer: undefined,
  });

  const pump = useCallback(() => {
    const s = sched.current;
    if (s.inFlight || !s.pending) return;
    if (s.timer !== undefined) clearTimeout(s.timer);
    s.timer = undefined;
    const wait = s.dueAt - Date.now();
    if (wait > 0) {
      s.timer = setTimeout(() => {
        s.timer = undefined;
        pump();
      }, wait);
      return;
    }
    const gen = s.gen;
    const startedAt = Date.now();
    s.pending = false;
    s.inFlight = true;
    s.lastStart = startedAt;
    void refreshRef
      .current()
      .catch(logRejection("useDockDiff.refresh"))
      .finally(() => {
        if (sched.current.gen !== gen) return; // session changed: a new scheduler epoch owns the state
        s.inFlight = false;
        s.slowStreak = Date.now() - startedAt > DOCK_DIFF_SLOW_MS ? Math.min(s.slowStreak + 1, MAX_STREAK) : 0;
        if (s.pending) s.dueAt = Math.max(s.dueAt, s.lastStart + windowMs(s.slowStreak));
        pump();
      });
  }, []);

  const request = useCallback(
    (kind: "now" | "settle") => {
      const s = sched.current;
      const at = Date.now();
      const due = Math.max(kind === "settle" ? at + DOCK_DIFF_SETTLE_MS : at, s.lastStart + windowMs(s.slowStreak));
      s.dueAt = s.pending ? Math.min(s.dueAt, due) : due;
      s.pending = true;
      pump();
    },
    [pump],
  );

  // First load per session (and a clean scheduler epoch).
  useEffect(() => {
    const s = sched.current;
    s.gen += 1;
    if (s.timer !== undefined) clearTimeout(s.timer);
    Object.assign(s, {
      inFlight: false,
      pending: false,
      dueAt: 0,
      lastStart: Number.NEGATIVE_INFINITY,
      slowStreak: 0,
      timer: undefined,
    });
    if (sessionId) request("now");
    return () => {
      if (s.timer !== undefined) clearTimeout(s.timer);
      s.timer = undefined;
      s.pending = false;
    };
  }, [sessionId, request]);

  const prevWorking = useRef(working);
  useEffect(() => {
    const wasWorking = prevWorking.current;
    prevWorking.current = working;
    if (sessionId && wasWorking && !working) request("settle");
  }, [working, sessionId, request]);

  const prevDirty = useRef(dirtyCount);
  useEffect(() => {
    const changed = prevDirty.current !== dirtyCount;
    prevDirty.current = dirtyCount;
    if (sessionId && changed && !working) request("settle");
  }, [dirtyCount, working, sessionId, request]);

  const retry = useCallback(() => request("now"), [request]);

  return useMemo<DockDiff>(() => {
    const all = data?.files ?? [];
    const files = all.filter((f) => f.previewable !== false);
    const outOfCwd = all.filter((f) => f.previewable === false);
    const hasServerTotals = data !== null && (data.totalAdditions !== undefined || data.totalDeletions !== undefined);
    const totals: DockDiffTotals | null = hasServerTotals
      ? { additions: data?.totalAdditions ?? 0, deletions: data?.totalDeletions ?? 0 }
      : sumTotals(files);
    return {
      files,
      outOfCwd,
      count: files.length,
      capped: files.length >= DOCK_DIFF_SERVER_CAP,
      totals,
      otherChangesCount: data?.otherChanges?.length ?? 0,
      loaded: data !== null,
      failed: error !== null,
      retry,
      refreshOnExpand: retry,
    };
  }, [data, error, retry]);
}
