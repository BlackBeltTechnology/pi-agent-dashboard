## ADDED Requirements

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
