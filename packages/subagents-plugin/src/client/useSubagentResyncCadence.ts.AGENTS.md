# useSubagentResyncCadence.ts — index

Open-inspector liveness (D4 v1): a mounted detail view re-fires `subagent_resync_request` on a backoff cadence — `CADENCE_BASE_MS` 2000, ×2 per idle tick, `CADENCE_MAX_MS` 30000 ceiling, reset on entry growth. ONE shared timer per subagent key, so inline inspector + popout never double-fire. No `emptyTimeline` precondition (that precondition is why a mounted view never re-fires today). See change: reduce-subagent-details-payload.
