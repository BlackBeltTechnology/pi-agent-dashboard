## ADDED Requirements

### Requirement: Periodic poll derivation runs off the main event loop

On the periodic / gated poll path (`force === false`), the server SHALL perform per-change artifact derivation (local fs evidence probes) and payload serialization in a `worker_threads` worker, so this CPU-bound and synchronous-fs work does not block the main event loop that serves HTTP requests and WebSocket frames. The main thread SHALL retain ownership of the `openspec list` CLI spawn, the spawn-concurrency semaphore, the per-cwd cache, the mtime/TOCTOU gate stamping, and the broadcast.

The worker behavior SHALL be governed by `DashboardConfig.openspec.useWorker` (default `true`). When `false`, derivation SHALL run in-process exactly as on the pre-worker path.

The force-refresh path (authoritative `openspec status --change` per change) SHALL remain on its existing async-spawn path and SHALL NOT require the worker.

#### Scenario: Derived payload is byte-identical to in-process derivation
- **WHEN** the worker derives `OpenSpecData` for a directory
- **THEN** the resulting `data` SHALL equal the in-process derivation for the same inputs
- **AND** the serialized payload SHALL equal `JSON.stringify(data)`

#### Scenario: Worker unavailable falls back in-process
- **WHEN** the worker cannot be spawned, times out, or crashes during a tick
- **THEN** the server SHALL derive that directory's data in-process for that cycle
- **AND** the broadcast SHALL still be emitted with correct, uncorrupted data

#### Scenario: useWorker disabled
- **WHEN** `DashboardConfig.openspec.useWorker` is `false`
- **THEN** the server SHALL run all derivation in-process and SHALL NOT spawn the poll worker

#### Scenario: Payload serialized exactly once per tick
- **WHEN** a directory's gated poll completes via the worker
- **THEN** the payload SHALL be serialized once (in the worker) and that serialized string SHALL be reused for both the change-detection diff and the broadcast
