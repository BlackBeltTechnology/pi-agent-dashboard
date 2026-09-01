# subagent-detail-dialog.spec.ts — index

Playwright spec (change: fix-subagent-live-detail-reliability D4). → see `subagent-detail-dialog.spec.ts.AGENTS.md` Also carries F4 (the live subagent timeline advances ≥ 2 distinct states in a 10 s window — collapse is retention-only and never suppresses a broadcast). See change: collapse-superseded-tool-execution-updates. The throttle cadence rows (F1/P1/P2/F2/F5/P4) MOVED to `subagent-tick-throttle.spec.ts` (synthetic-producer arm). See change: reduce-bridge-tick-bandwidth.
