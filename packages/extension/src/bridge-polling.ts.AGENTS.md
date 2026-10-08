# bridge-polling.ts — index

Testable seams from `bridge.ts` to the poll-cost machinery: `createPollingHolder` (scan + tracker, replace disposes previous), `teardownPreviousIncarnation` (no-op on subagent re-entry), `drainDisposables`, `feedPollingEvent`, `routeGitInfoRefresh` (EVERY `git_info_refresh` → tracker), `scheduleModelRecheckOnSelect` (50 ms). See change: optimize-polling-hot-paths.
