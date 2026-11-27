# telemetry.ts — index

`createTelemetry(logger)`: per-team counters (`spawns`, `claims`, `claimConflicts`, `deliveries`, `queued`, `urgentAborts`, `rateLimited`; in memory) and `log(event, teamId, fields, head?)` structured `agent-teams: <event> team=<id> k=v` lines (ids, names, sizes only; never bodies, results, errors). Events `user_stop`/`user_shutdown` (UI routes). See change: add-agent-teams-ui.
