/**
 * Counters as structured log lines: `agent-teams: counter counter=<name> n=<v> window_s=60`,
 * aggregated and flushed every 60 s while something was counted (no timer at rest,
 * nothing logged for a quiet window). Names are fixed identifiers; values are
 * numbers — no agent text can reach a counter line.
 * See change: add-agent-teams-ui.
 */
import type { Clock } from "../shared/clock.js";
import type { Logger } from "./types.js";

export interface UiCounters {
  count(name: string, n?: number): void;
  /** Flush what is pending now and stop the timer. */
  dispose(): void;
}

export interface UiCountersDeps {
  logger: Logger;
  clock: Clock;
  windowMs?: number;
}

export function createUiCounters(deps: UiCountersDeps): UiCounters {
  const windowMs = deps.windowMs ?? 60_000;
  const totals = new Map<string, number>();
  let timer: unknown;

  function flush(): void {
    timer = undefined;
    for (const [name, n] of [...totals].sort(([a], [b]) => a.localeCompare(b))) deps.logger.info(`agent-teams: counter counter=${name} n=${n} window_s=${Math.round(windowMs / 1000)}`);
    totals.clear();
  }

  return {
    count(name, n = 1) {
      totals.set(name, (totals.get(name) ?? 0) + n);
      if (timer === undefined) timer = deps.clock.setTimeout(flush, windowMs);
    },
    dispose() {
      if (timer !== undefined) deps.clock.clearTimeout(timer);
      timer = undefined;
      totals.clear();
    },
  };
}
