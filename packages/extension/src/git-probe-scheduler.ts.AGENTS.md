# git-probe-scheduler.ts — index

Pure two-lane probe scheduler (injected clock/timers). `request(lane, reason)`: 750 ms trailing debounce capped at 2 s max wait; fast lane ≥ 2 s / slow lane ≥ 10 s between probe starts (deferred, never dropped); fast supersedes slow and refreshes the slow window; one in flight + dirty bit → exactly one follow-up; probe resolving `"discard"` → one more fast probe; `dispose()` ignores late settles. Exports `createGitProbeScheduler`, `GitProbeScheduler`, `ProbeLane`, `ProbeReason`, `ProbeOutcome`.
See change: optimize-polling-hot-paths.
