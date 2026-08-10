import React from "react";
import { type CompactionState, deriveCompactionBadge } from "../../lib/chat/event-reducer.js";

interface Props {
  /** Tokens used, or null/undefined if unknown */
  tokens: number | null | undefined;
  /** Total context window size */
  contextWindow: number | undefined;
  /** Compact inline mode: fixed width, no percentage text */
  compact?: boolean;
  /**
   * Compaction metadata from the most recent `session_compact` (pi
   * 0.79.8/0.79.10+). When present with a `reason`, a small badge renders
   * next to the bar (e.g. `auto-threshold −12.4k`). Absent → no badge, bar
   * identical to today. See change: adopt-pi-074-080-features (C.1).
   */
  compaction?: CompactionState;
}

function getBarColor(pct: number): string {
  if (pct > 80) return "bg-red-500";
  if (pct > 50) return "bg-yellow-500";
  return "bg-green-500";
}

export function ContextUsageBar({ tokens, contextWindow, compact, compaction }: Props) {
  const hasData = tokens != null && contextWindow != null && contextWindow > 0;
  const pct = hasData ? Math.min(100, (tokens / contextWindow) * 100) : 0;
  const badge = deriveCompactionBadge(compaction);

  return (
    <div className={compact ? "flex items-center w-16" : "flex items-center gap-2"} data-testid="context-usage-bar">
      <div
        className="h-1.5 flex-1 rounded-full bg-gray-300 dark:bg-gray-600 overflow-hidden"
        title={hasData ? `${Math.round(pct)}% context used (${tokens.toLocaleString()} / ${contextWindow.toLocaleString()})` : "No context data"}
      >
        {hasData && (
          <div
            className={`h-full rounded-full ${getBarColor(pct)}`}
            style={{ width: `${pct}%` }}
            data-testid="context-usage-fill"
          />
        )}
      </div>
      {hasData && !compact && (
        <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums" data-testid="context-usage-pct">
          {Math.round(pct)}%
        </span>
      )}
      {badge && (
        <span
          className="flex-shrink-0 inline-flex items-center gap-0.5 px-1 py-0 text-[10px] rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 tabular-nums whitespace-nowrap"
          data-testid="compaction-badge"
          title={`Context compacted (${badge.label})${badge.reductionText ? ` ${badge.reductionText} tokens` : ""}`}
        >
          {badge.reductionText ? `${badge.label} ${badge.reductionText}` : badge.label}
        </span>
      )}
    </div>
  );
}
