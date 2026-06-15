## ADDED Requirements

### Requirement: Session hydration is timed and observable

The server SHALL measure the wall-clock duration of every session-event hydration (`loadSessionEvents`) and expose recent timings plus a process-wide event-loop delay measurement, so operators can quantify main-loop stalls caused by hydration before any optimization is applied. Measurement SHALL NOT alter the `LoadResult` returned to the hydration caller and SHALL NOT add fs reads or payload serialization beyond an O(1) record into an in-memory ring buffer.

#### Scenario: Each hydration records a timing sample
- **WHEN** `loadSessionEvents` completes (success or failure)
- **THEN** the server SHALL record a sample `{ sessionId, wallMs, fileBytes, entryCount, eventCount, at }` into a fixed-capacity ring buffer
- **AND** the recording SHALL NOT change the returned `LoadResult`

#### Scenario: Slow hydration emits a warning
- **WHEN** a hydration's `wallMs` exceeds the slow-load threshold
- **THEN** the server SHALL emit a `[hydration] slow load` warning including `wallMs`, `sessionId`, and `fileBytes`

#### Scenario: Health endpoint surfaces recent hydration timings
- **WHEN** a client GETs `/api/health`
- **THEN** the response SHALL include a `hydration` array of the most recent samples, newest-first, capped at the ring-buffer capacity

#### Scenario: Health endpoint surfaces event-loop delay
- **WHEN** a client GETs `/api/health`
- **THEN** the response SHALL include `eventLoopDelay: { meanMs, p99Ms, maxMs }` derived from a `perf_hooks` event-loop delay histogram
- **AND** the histogram window SHALL reset after the read so subsequent reads reflect recent activity

#### Scenario: Additive, backward-compatible health payload
- **WHEN** an existing client that does not know the new fields reads `/api/health`
- **THEN** the `eventLoopDelay` and `hydration` fields SHALL be additive and SHALL NOT break parsing of pre-existing fields
