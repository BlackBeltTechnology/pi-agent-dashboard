# eventloop-spike-monitoring Specification

## Purpose

Provide a safety-net feed for capturing worst-case event-loop-delay spikes that no instrumented poll turn owns (GC pauses, session-hydration deserialization, WebSocket on-connect work). A dedicated `monitorEventLoopDelay` sampler owns its own histogram, emits a spike when the sampled `max` reaches a floor, and records it into a bounded ring buffer that is independent of the `/api/health` event-loop-delay histogram, so measurement of stalls never perturbs the health-endpoint statistics.

## Requirements

### Requirement: Dedicated event-loop-delay sampler

The system SHALL run a dedicated `monitorEventLoopDelay` histogram, separate from the `/api/health` boot histogram, sampled on a fixed cadence. It SHALL create and enable its own histogram when one is not injected, and disable it only when it owns it.

#### Scenario: Sampler owns and enables its histogram

- WHEN the sampler is started without an injected histogram
- THEN it creates a fresh `monitorEventLoopDelay` instance with resolution 20
- AND it enables that histogram
- AND it snapshots the histogram `max` once per interval

#### Scenario: Sampler uses an injected histogram without owning it

- WHEN the sampler is started with a histogram provided by the caller
- THEN it uses that histogram without enabling it
- AND on stop it does NOT disable the injected histogram

#### Scenario: Sampler does not keep the process alive

- WHEN the sampler's interval timer is created
- THEN the timer is unreferenced so it never keeps the process alive for a diagnostic sampler

### Requirement: Spike emission above the floor

On each sample the system SHALL convert the histogram `max` from nanoseconds to milliseconds, and SHALL invoke `onSpike(maxMs)` only when `maxMs` is finite and greater than or equal to the configured floor. After every sample it SHALL reset its own histogram so each interval reflects only recent activity.

#### Scenario: Sample at or above the floor emits a spike

- WHEN a sampled `max` is greater than or equal to the floor of 100 ms
- THEN `onSpike` is invoked with that `max` in milliseconds
- AND the sampler's own histogram is reset

#### Scenario: Sample below the floor emits no spike

- WHEN a sampled `max` is finite but below the floor of 100 ms
- THEN `onSpike` is NOT invoked
- AND the sampler's own histogram is still reset

#### Scenario: Non-finite sample emits no spike

- WHEN the sampled `max` is not a finite number
- THEN `onSpike` is NOT invoked
- AND the sampler's own histogram is still reset

#### Scenario: Server boot configuration

- WHEN the server boots the sampler
- THEN the floor is 100 ms
- AND the sample cadence is 1000 ms

### Requirement: Failure isolation of measurement

The system SHALL ensure that a failure in the sampling or recording path never propagates to the process. Sampling and recording errors SHALL be caught and swallowed.

#### Scenario: Sampling throws

- WHEN reading or resetting the histogram throws during a tick
- THEN the error is caught and the process is unaffected

#### Scenario: Spike recording throws

- WHEN `onSpike` recording into the spike buffer throws
- THEN the error is caught and the sampling loop continues

### Requirement: Bounded spike ring buffer

The system SHALL retain recent spikes in a process-local, in-memory ring buffer with a fixed capacity, with no persistence. Each recorded spike SHALL capture the epoch timestamp, the delay in milliseconds, and the attributed turn. On boot the capacity SHALL be 50.

#### Scenario: Record within capacity

- WHEN a spike is recorded and the buffer holds fewer than capacity entries
- THEN the spike is appended and no entry is evicted

#### Scenario: Eviction when capacity is exceeded

- WHEN a spike is recorded and the buffer already holds capacity entries
- THEN the oldest entry is evicted so the buffer never exceeds capacity

#### Scenario: Invalid capacity is guarded

- WHEN the buffer is created with a non-finite capacity
- THEN capacity falls back to 1 so eviction always runs and the buffer stays bounded
- AND a finite capacity is floored to an integer and clamped to a minimum of 1

#### Scenario: Snapshot is newest-first and mutation-safe

- WHEN a caller requests a snapshot
- THEN it receives a fresh array of spikes ordered most-recent-first
- AND mutating the returned array does not affect the internal buffer

### Requirement: Independent dual-feed attribution

The spike buffer SHALL be fed by two independent producers whose spikes are distinguished by the `turn` field. The dedicated sampler SHALL record spikes with `turn` set to `null`, and the OpenSpec poll path SHALL self-record spikes with a named turn. The dedicated sampler SHALL never touch the `/api/health` delay histogram.

#### Scenario: Sampler records unattributed spikes

- WHEN the dedicated sampler records a spike into the buffer
- THEN the entry has `turn` equal to `null`
- AND its timestamp is the current epoch milliseconds

#### Scenario: Poll path records attributed spikes

- WHEN the OpenSpec poll path self-records a spike
- THEN the entry has `turn` equal to one of `tickOpen`, `dirPollPre`, or `dirPollPost`

#### Scenario: Sampler leaves the health histogram unaffected

- WHEN the dedicated sampler samples and resets its own histogram
- THEN the `/api/health` event-loop-delay histogram mean, p99, and max are unaffected because the sampler never reads or resets it
