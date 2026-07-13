/**
 * `useGoals(cwd)` — fetch the folder's GoalRecords on mount + expose a
 * `refetch`. v1 refetches after mutations / on the board's Refresh button
 * (no live `goals_update` WS subscription yet; the plugin message bus only
 * delivers per-session plugin events). See change: add-goals-folder-page.
 */

import type { GoalRecord, GoalRecordStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { fetchGoals } from "./goals-api.js";

export interface UseGoalsResult {
  goals: GoalRecord[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useGoals(cwd: string | null | undefined): UseGoalsResult {
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!cwd) {
      setGoals([]);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    fetchGoals(cwd, ac.signal)
      .then((g) => setGoals(g))
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [cwd, nonce]);

  return { goals, loading, error, refetch };
}

/** UI palette + label for a goal's durable status. */
export function statusMeta(status: GoalRecordStatus): { label: string; dot: string; cls: string } {
  switch (status) {
    case "achieved":
      return { label: "Achieved", dot: "✓", cls: "text-green-400 border-green-500/40 bg-green-500/5" };
    case "paused":
      return { label: "Paused", dot: "⏸", cls: "text-amber-400 border-amber-500/40 bg-amber-500/5" };
    case "cleared":
      return { label: "Cleared", dot: "○", cls: "text-[var(--text-muted)] border-[var(--border-subtle)] bg-transparent" };
    case "respawning":
      // Visible, non-terminal: the supervisor has no live driver and a respawn
      // is pending. See change: add-goal-session-supervisor.
      return { label: "Respawning", dot: "↻", cls: "text-sky-400 border-sky-500/40 bg-sky-500/5" };
    case "failed":
      // Terminal supervisor verdict (crash-loop breaker / stop failed).
      return { label: "Failed", dot: "✕", cls: "text-red-400 border-red-500/40 bg-red-500/5" };
    case "pursuing":
    default:
      return { label: "Pursuing", dot: "●", cls: "text-indigo-400 border-indigo-500/40 bg-indigo-500/5" };
  }
}
