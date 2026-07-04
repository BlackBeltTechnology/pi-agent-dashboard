# server-session-hydration Specification

## Purpose
Measure and surface session-event hydration cost so operators can quantify main-loop stalls caused by `loadSessionEvents` before any optimization (e.g. worker offload) is applied. Scope: per-hydration wall-time sampling, a process-wide event-loop delay measurement, and additive `/api/health` reporting. Measurement only — no change to hydration semantics or the returned `LoadResult`.
## Requirements
### Requirement: Session hydration is timed and observable

The server SHALL measure the wall-clock duration of every session-event hydration (`loadSessionEvents`) and expose recent timings plus a process-wide event-loop delay measurement, so operators can quantify main-loop stalls caused by hydration before any optimization is applied. Measurement SHALL NOT alter the `LoadResult` returned to the hydration caller. Per-call measurement overhead SHALL be bounded to an O(1) record into an in-memory ring buffer plus at most a single best-effort `stat` of the session file (for `fileBytes`); it SHALL NOT serialize large payloads. A failure in the measurement path SHALL NOT propagate to the caller.

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

### Requirement: Session-event hydration runs off the main event loop

The server SHALL perform session-event hydration parsing and replay (`loadSessionEntries` JSONL parse + tree-walk, and `replayEntriesAsEvents` materialization) in a `worker_threads` worker, so this CPU-bound and synchronous-fs work does not block the main event loop that serves HTTP requests and WebSocket frames. The main thread SHALL retain ownership of the per-session `loadingSet` dedup, the `eventStore` inserts, and the `event_replay` / `session_updated` broadcasts.

The behavior SHALL be governed by `DashboardConfig.sessions.useLoadWorker` (default `true`). When `false`, hydration SHALL run in-process exactly as on the pre-worker path.

#### Scenario: Hydrated events are identical to in-process replay
- **WHEN** the worker hydrates a session
- **THEN** the resulting `events` array SHALL equal the in-process `loadSessionEntries` + `replayEntriesAsEvents` projection for the same session file and known context window
- **AND** this SHALL hold for both tree-branch and linear-fallback session files

#### Scenario: Worker unavailable falls back in-process
- **WHEN** the worker cannot be spawned, times out, or crashes during a hydration
- **THEN** the server SHALL hydrate that session in-process for that request
- **AND** the `event_replay` SHALL still be emitted with correct, uncorrupted events

#### Scenario: In-flight hydration is cancellable
- **WHEN** a client unsubscribes from a session, or subscribes to a different session, before its hydration resolves
- **THEN** the server SHALL cancel the in-flight hydration job
- **AND** the cancelled job's result SHALL NOT be inserted into the event store nor broadcast
- **AND** a plain cancel SHALL NOT terminate the worker (only timeout/crash terminates it)

#### Scenario: useLoadWorker disabled
- **WHEN** `DashboardConfig.sessions.useLoadWorker` is `false`
- **THEN** the server SHALL run all hydration in-process and SHALL NOT spawn the session-load worker

#### Scenario: Dedup unaffected by offload
- **WHEN** two concurrent requests hydrate the same session id
- **THEN** the existing `loadingSet` dedup SHALL still prevent re-entrant loads on the main thread regardless of where parsing runs

### Requirement: Event-loop stalls are retained independently of poll timing

The server SHALL retain recent worst-case event-loop-delay observations in a
bounded, process-local, in-memory ring buffer. Each retained observation SHALL
carry at least a timestamp and the delay in milliseconds, and MAY carry an
optional attributed source turn label (`null` when unattributed). Recording SHALL
be O(1) with no serialization of large payloads, and a failure in the
measurement path SHALL NOT propagate to request handling.

The buffer SHALL be populated by two independent feeds:
- a **dedicated `monitorEventLoopDelay` histogram instance** (never the
  `/api/health` boot histogram) sampled on a fixed cadence, whose above-floor
  `max` is recorded with a `null` turn label — a safety net that captures stalls
  no instrumented turn owns (e.g. GC, session-hydration deserialize, WS
  on-connect), and
- per-turn self-records contributed by the OpenSpec poll path (defined in the
  `server-openspec-polling` spec).

Because the sampler owns a dedicated histogram, it SHALL NOT read or reset the
`/api/health` histogram, so `/api/health`'s `eventLoopDelay` mean/p99/max stay
unaffected. A sub-threshold stall (e.g. ~700ms) SHALL therefore be recorded even
when no client polls `/api/health` at the instant it occurs.

#### Scenario: A stall is captured without an in-flight health poll
- **GIVEN** no client is calling `/api/health`
- **WHEN** the main thread blocks for longer than the retention sampling interval
- **THEN** the server SHALL retain an event-loop observation for that block with its timestamp and duration

#### Scenario: Dedicated sampler does not disturb the health histogram
- **WHEN** the retention sampler snapshots and resets its own histogram
- **THEN** the `/api/health` `eventLoopDelay` mean/p99/max SHALL be unaffected

#### Scenario: An unattributed stall is retained with a null turn
- **GIVEN** a main-thread stall occurs outside any instrumented poll turn
- **WHEN** the dedicated sampler observes it above the floor
- **THEN** the server SHALL retain the observation with a `null` turn label

#### Scenario: Retention buffer is bounded
- **WHEN** more observations are recorded than the buffer capacity
- **THEN** the oldest observations SHALL be evicted and the buffer SHALL NOT grow unbounded

#### Scenario: Health endpoint surfaces retained stalls
- **WHEN** a client GETs `/api/health`
- **THEN** the response SHALL include the retained event-loop stall observations additively, without removing existing `eventLoopDelay` or `hydration` fields

