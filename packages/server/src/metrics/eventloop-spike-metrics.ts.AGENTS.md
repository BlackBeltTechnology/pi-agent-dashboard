# eventloop-spike-metrics.ts — index

Ring buffer of worst-case event-loop stalls. `createEventLoopSpikeMetrics(capacity)` → `{record(spike),snapshot()}`. Spike `{at,ms,turn}`; `turn: "tickOpen"\|"dirPollPre"\|"dirPollPost"\|null`. Newest-first, capped, O(1), process-local. Two feeds: dedicated sampler (`turn:null`) + poll-path per-turn self-records. Reuses `hydration-metrics.ts` container shape, NOT its event-driven record model. Server boots capacity 50; `/api/health` reads `snapshot()`. See change: attribute-openspec-poll-eventloop-stalls.
