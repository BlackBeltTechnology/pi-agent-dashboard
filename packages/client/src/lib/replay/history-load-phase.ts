/**
 * Pure per-session history-load phase derivation, computed once in `App` and
 * read by both the chat view (selected entry) and the session cards (whole map).
 * See change: show-session-history-load-state (design D1).
 */
import type { SessionState } from "../chat/event-reducer.js";

export type HistoryLoadPhase = "idle" | "waiting" | "loading" | "failed";

/** Loading longer than this surfaces the slow-load notice / tooltip seconds. */
export const SLOW_LOAD_MS = 10_000;

/**
 * The exact gate ChatView's empty branch uses, extracted so both agree.
 * Steering counts even when the reduced state is still `undefined`.
 */
export function hasChatContent(state: SessionState | undefined, pendingSteering?: readonly unknown[]): boolean {
  if (pendingSteering && pendingSteering.length > 0) return true;
  if (!state) return false;
  return state.messages.length > 0 || !!state.streamingText || !!state.pendingPrompt;
}

export interface HistoryLoadPhaseInput {
  selected: boolean;
  connected: boolean;
  hasContent: boolean;
  /** `loadingHistory || replayInFlight`. */
  loading: boolean;
  failed: boolean;
}

/** Precedence (first match wins): waiting → loading → failed → idle. */
export function deriveHistoryLoadPhase(i: HistoryLoadPhaseInput): HistoryLoadPhase {
  if (i.selected && !i.connected && !i.hasContent) return "waiting";
  if (i.loading && i.connected) return "loading";
  if (i.failed && i.connected && !i.hasContent) return "failed";
  return "idle";
}

export interface HistoryPhaseEntry {
  phase: Exclude<HistoryLoadPhase, "idle">;
  /** Present only while `loading`. */
  startedAt?: number;
}

export interface BuildHistoryPhaseMapInput {
  loadingHistory: ReadonlyMap<string, boolean>;
  replayInFlight: ReadonlyMap<string, boolean>;
  historyLoadFailed: ReadonlyMap<string, boolean>;
  historyLoadStartedAt: ReadonlyMap<string, number>;
  selectedId: string | undefined;
  connected: boolean;
  hasContent: (id: string) => boolean;
}

/**
 * Non-idle phases for the ids whose value is TRUE in any flag map, plus the
 * selected id. The flag maps keep `false` entries after a clear, so iterating
 * every key would be O(every session ever loaded).
 */
export function buildHistoryPhaseMap(i: BuildHistoryPhaseMapInput): Map<string, HistoryPhaseEntry> {
  const ids = new Set<string>();
  for (const m of [i.loadingHistory, i.replayInFlight, i.historyLoadFailed]) {
    for (const [id, v] of m) if (v) ids.add(id);
  }
  if (i.selectedId) ids.add(i.selectedId);
  const out = new Map<string, HistoryPhaseEntry>();
  for (const id of ids) {
    const phase = deriveHistoryLoadPhase({
      selected: id === i.selectedId,
      connected: i.connected,
      hasContent: i.hasContent(id),
      loading: !!i.loadingHistory.get(id) || !!i.replayInFlight.get(id),
      failed: !!i.historyLoadFailed.get(id),
    });
    if (phase === "idle") continue;
    const startedAt = phase === "loading" ? i.historyLoadStartedAt.get(id) : undefined;
    out.set(id, startedAt === undefined ? { phase } : { phase, startedAt });
  }
  return out;
}
