# subagent-frame-strip.ts — index

Drops `details.entries` from `queued`/`running` subagent frames on the forward path. Exports `stripSubagentEntries`, `stripForForward`, `NON_TERMINAL_STATUSES`. ALLOWLIST not `!terminal` (`"stopped"` must survive); CLONES because the buffer retains frames by reference. Rollback flag `PI_DASHBOARD_SUBAGENT_STRIP=0`. See change: reduce-subagent-details-payload.
