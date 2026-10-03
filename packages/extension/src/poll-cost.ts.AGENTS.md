# poll-cost.ts — index

Flat cumulative poll-cost counters (`pollProcScanRuns/Spawns/Ms`, `pollGitProbesTick/Tool/Watch/Refresh`, `pollGitSpawns/Ms`, `pollGitWatchersAttached`) spread into heartbeat `metrics`; `/api/health` SUMS them across sessions as `pollCost`. Exports `pollCost`, `incPollCost`, `PollCost`, `__resetPollCostForTests`.
See change: optimize-polling-hot-paths.
