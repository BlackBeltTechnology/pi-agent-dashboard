/**
 * Poll-cost counters (change: optimize-polling-hot-paths). A plain counter
 * object incremented from the EXISTING scan/git call sites and spread into
 * the heartbeat `metrics`. Cumulative for the bridge's lifetime; the server
 * sums each field across live sessions on `/api/health`.
 */
export interface PollCost {
  pollProcScanRuns: number;
  pollProcScanSpawns: number;
  pollProcScanMs: number;
  pollGitProbesTick: number;
  pollGitProbesTool: number;
  pollGitProbesWatch: number;
  pollGitProbesRefresh: number;
  pollGitSpawns: number;
  pollGitMs: number;
  pollGitWatchersAttached: number;
}

export const pollCost: PollCost = {
  pollProcScanRuns: 0,
  pollProcScanSpawns: 0,
  pollProcScanMs: 0,
  pollGitProbesTick: 0,
  pollGitProbesTool: 0,
  pollGitProbesWatch: 0,
  pollGitProbesRefresh: 0,
  pollGitSpawns: 0,
  pollGitMs: 0,
  pollGitWatchersAttached: 0,
};

export function incPollCost(key: keyof PollCost, by = 1): void {
  pollCost[key] += by;
}

/** Test-only reset. */
export function __resetPollCostForTests(): void {
  for (const k of Object.keys(pollCost) as (keyof PollCost)[]) pollCost[k] = 0;
}
