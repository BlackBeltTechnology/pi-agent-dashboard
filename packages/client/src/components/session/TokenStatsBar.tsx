import React from "react";
import { contextGradientColor } from "../../lib/theme/context-gradient.js";
import type { TurnStat } from "../../lib/chat/event-reducer.js";

interface Props {
  turnStats: TurnStat[];
  contextUsage?: { tokens: number | null; contextWindow: number };
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  onTurnClick?: (turnIndex: number) => void;
  /** Gate butterfly chart + token stats (default true). */
  showStats?: boolean;
  /** Gate context-window progress bar (default true). */
  showContextBar?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TokenStatsBar({ turnStats, contextUsage, tokensIn, tokensOut, cacheRead, cacheWrite, cost, onTurnClick, showStats = true, showContextBar = true }: Props) {
  // Independent normalization per half
  const maxInput = turnStats.reduce(
    (max, t) => Math.max(max, t.input + t.cacheRead),
    0
  );
  const maxOutput = turnStats.reduce(
    (max, t) => Math.max(max, t.output),
    0
  );

  const contextPercent =
    contextUsage?.tokens != null && contextUsage.contextWindow > 0
      ? (contextUsage.tokens / contextUsage.contextWindow) * 100
      : null;

  const gradientColor = contextPercent != null ? contextGradientColor(contextPercent) : null;

  // Latest turn for context bar segment proportions
  const latestTurn = turnStats.length > 0 ? turnStats[turnStats.length - 1] : null;
  const latestTotal = latestTurn
    ? latestTurn.cacheRead + latestTurn.cacheWrite + latestTurn.input + latestTurn.output
    : 0;

  return (
    <div className="px-3 py-1.5 border-b border-[var(--border-primary)] space-y-1">
      {/* Main row: chart left, stats right */}
      {showStats && turnStats.length > 0 && (
        <div className="flex gap-3">
          {/* Stats panel on the left */}
          <div className="flex flex-col justify-center text-[9px] text-[var(--text-tertiary)] leading-tight whitespace-nowrap" data-testid="stats-panel">
            <div><span className="text-blue-500">●</span> ↓{formatTokens(maxInput)}</div>
            <div><span className="text-purple-500">●</span> ↑{formatTokens(maxOutput)}</div>
            <div className="flex gap-1.5">
              <span>↓{formatTokens(tokensIn + cacheRead)}</span>
              <span>↑{formatTokens(tokensOut)}</span>
            </div>
            <div className="flex gap-1.5">
              {cacheRead > 0 && <span>R{formatTokens(cacheRead)}</span>}
              {cacheWrite > 0 && <span>W{formatTokens(cacheWrite)}</span>}
              {cost > 0 && <span>${cost.toFixed(2)}</span>}
            </div>
          </div>

          {/* Butterfly chart */}
          <div className="flex-1 min-w-0">
            <div className="flex gap-px" data-testid="butterfly-chart">
              {turnStats.map((turn, i) => {
                const inputScale = maxInput > 0 ? (turn.input + turn.cacheRead) / maxInput : 0;
                const inputHeight = Math.max(inputScale * 100, 4);

                const outputScale = maxOutput > 0 ? turn.output / maxOutput : 0;
                const outputHeight = Math.max(outputScale * 100, 4);

                // When fewer than 50 bars, cap width so bars don't get too wide
                const barMaxWidth = turnStats.length < 50 ? `${100 / 50}%` : undefined;
                return (
                  <div
                    key={i}
                    {...(onTurnClick && turn.turnIndex >= 0 ? { "data-testid": "turn-bar", "data-turn-index": turn.turnIndex } : {})}
                    className={`flex flex-col flex-1 min-w-[2px]${onTurnClick && turn.turnIndex >= 0 ? " cursor-pointer" : ""}`}
                    style={{ height: "100%", maxWidth: barMaxWidth }}
                    title={`In: ${formatTokens(turn.input + turn.cacheRead)} Out: ${formatTokens(turn.output)}`}
                    onClick={onTurnClick && turn.turnIndex >= 0 ? () => onTurnClick(turn.turnIndex) : undefined}
                  >
                    {/* Input half — grows upward */}
                    <div className="h-[13px] flex flex-col justify-end">
                      <div
                        className="w-full overflow-hidden rounded-t-sm bg-blue-500"
                        style={{ height: `${inputHeight}%` }}
                      />
                    </div>

                    {/* Center axis */}
                    <div className="h-px bg-[var(--border-subtle)] flex-shrink-0" />

                    {/* Output half — grows downward */}
                    <div className="h-[13px] flex flex-col justify-start">
                      <div
                        className="w-full overflow-hidden rounded-b-sm bg-purple-500"
                        style={{ height: `${outputHeight}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>


        </div>
      )}

      {/* Fallback stats when no turns */}
      {showStats && turnStats.length === 0 && (tokensIn > 0 || tokensOut > 0 || cost > 0) && (
        <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
          <span>↓{formatTokens(tokensIn + cacheRead)}</span>
          <span>↑{formatTokens(tokensOut)}</span>
          {cacheRead > 0 && <span>R{formatTokens(cacheRead)}</span>}
          {cacheWrite > 0 && <span>W{formatTokens(cacheWrite)}</span>}
          {cost > 0 && <span>${cost.toFixed(2)}</span>}
        </div>
      )}

      {/* Context window stacked progress bar. Segments update their width
          instantly (no `transition-all`): a width transition is a
          non-composited, layout-animating offender and the value change is
          imperceptible without the tween. See change:
          reduce-chat-render-cpu-umbrella (Phase 1, task 2.2). */}
      {showContextBar && contextUsage && contextUsage.contextWindow > 0 && (
        <div className="flex items-center gap-2 text-[9px] text-[var(--text-tertiary)]">
          <span>{contextUsage.tokens != null ? formatTokens(contextUsage.tokens) : "—"}</span>
          <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden flex" data-testid="context-bar">
            {contextPercent != null && latestTurn && latestTotal > 0 ? (
              <>
                {latestTurn.cacheRead > 0 && (
                  <div
                    className="h-full"
                    style={{ width: `${(latestTurn.cacheRead / latestTotal) * contextPercent}%`, backgroundColor: gradientColor! }}
                  />
                )}
                {latestTurn.cacheWrite > 0 && (
                  <div
                    className="h-full"
                    style={{ width: `${(latestTurn.cacheWrite / latestTotal) * contextPercent}%`, backgroundColor: gradientColor! }}
                  />
                )}
                <div
                  className="h-full"
                  style={{ width: `${(latestTurn.input / latestTotal) * contextPercent}%`, backgroundColor: gradientColor! }}
                />
                {latestTurn.output > 0 && (
                  <div
                    className="h-full"
                    style={{ width: `${(latestTurn.output / latestTotal) * contextPercent}%`, backgroundColor: gradientColor! }}
                  />
                )}
              </>
            ) : contextPercent != null ? (
              <div
                className="h-full"
                style={{ width: `${Math.min(contextPercent, 100)}%`, backgroundColor: gradientColor! }}
              />
            ) : null}
          </div>
          <span>{formatTokens(contextUsage.contextWindow)}</span>
        </div>
      )}
    </div>
  );
}
