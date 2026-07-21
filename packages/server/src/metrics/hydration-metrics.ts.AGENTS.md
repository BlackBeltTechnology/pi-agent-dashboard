# hydration-metrics.ts — index

Ring-buffer recorder for session-hydration timings. `createHydrationMetrics(capacity)` → `{ record(sample), snapshot() }`. Sample `{ sessionId, wallMs, fileBytes, entryCount, eventCount, at }`. `snapshot()` newest-first, capped at capacity. Process-local, no persistence. Shared by `directory-service` + `/api/health`. Server boots one instance capacity 20. See change: instrument-session-hydration-timing. Sibling `eventloop-spike-metrics.ts` reuses this container shape for event-loop stalls. See change: attribute-openspec-poll-eventloop-stalls.
