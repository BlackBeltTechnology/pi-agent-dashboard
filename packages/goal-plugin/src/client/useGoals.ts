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

/**
 * UI palette + label for a goal's durable status. Identity tints (tint fg on
 * its own tint bg). See change: align-ui-with-theme-tokens (D2).
 */
export function statusMeta(status: GoalRecordStatus): { label: string; dot: string; cls: string } {
  switch (status) {
    case "achieved":
      return { label: "Achieved", dot: "✓", cls: "text-[var(--tint-green-fg)] border-[var(--tint-green-border)] bg-[var(--tint-green-bg)]" };
    case "paused":
      return { label: "Paused", dot: "⏸", cls: "text-[var(--tint-orange-fg)] border-[var(--tint-orange-border)] bg-[var(--tint-orange-bg)]" };
    case "cleared":
      return { label: "Cleared", dot: "○", cls: "text-[var(--text-secondary)] border-[var(--border-subtle)] bg-transparent" };
    case "respawning":
      // Visible, non-terminal: the supervisor has no live driver and a respawn
      // is pending. See change: add-goal-session-supervisor.
      return { label: "Restarting", dot: "↻", cls: "text-[var(--tint-blue-fg)] border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)]" };
    case "failed":
      // Terminal supervisor verdict (crash-loop breaker / stop failed).
      return { label: "Failed", dot: "✕", cls: "text-[var(--tint-red-fg)] border-[var(--tint-red-border)] bg-[var(--tint-red-bg)]" };
    case "pursuing":
    default:
      return { label: "Pursuing", dot: "●", cls: "text-[var(--tint-purple-fg)] border-[var(--tint-purple-border)] bg-[var(--tint-purple-bg)]" };
  }
}
