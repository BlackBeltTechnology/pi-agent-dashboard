import React from "react";

interface Props {
  /** Tokens used, or null/undefined if unknown */
  tokens: number | null | undefined;
  /** Total context window size */
  contextWindow: number | undefined;
  /** Compact inline mode: fixed width, no percentage text */
  compact?: boolean;
}

function getBarColor(pct: number): string {
  if (pct > 80) return "bg-red-500";
  if (pct > 50) return "bg-yellow-500";
  return "bg-green-500";
}

export function ContextUsageBar({ tokens, contextWindow, compact }: Props) {
  const hasData = tokens != null && contextWindow != null && contextWindow > 0;
  const pct = hasData ? Math.min(100, (tokens / contextWindow) * 100) : 0;

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
    </div>
  );
}
