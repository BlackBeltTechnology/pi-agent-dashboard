# settings-panel — delta

## ADDED Requirements

### Requirement: The panel SHALL disclose the server-heap/store-budget coupling

The panel SHALL surface a non-blocking warning when the store budget converted
to heap leaves insufficient room under the server ceiling, including the
unlimited case of `maxTotalEventBytes` set to `0`.

Both keys live on the Server page, but they multiply into a third quantity — the
heap the store will actually occupy — that neither field displays, so a pairing
that guarantees an OOM looks unremarkable at the point of either edit.

#### Scenario: Unlimited store budget is disclosed
- **WHEN** the operator sets `maxTotalEventBytes` to `0` against the default `1536` MB ceiling
- **THEN** the panel SHALL warn that the store is unbounded under a bounded ceiling
- **AND** the value SHALL remain saveable

#### Scenario: Unlimited budget is described as unbounded, not as a figure
- **WHEN** `maxTotalEventBytes` is `0`
- **THEN** the warning SHALL describe the store as unbounded rather than reporting a heap-equivalent number

#### Scenario: Warning names the heap-equivalent for a finite budget
- **WHEN** the operator raises `maxTotalEventBytes` to `2048` MiB against a `1536` MB ceiling
- **THEN** the warning SHALL report the budget's heap-equivalent rather than the raw budget

#### Scenario: The warning appears on both fields
- **WHEN** the pairing is unsafe
- **THEN** the warning SHALL be surfaced on the server heap field and on the memory-limits budget field

### Requirement: Heap fields SHALL state their effect boundary

Each heap field SHALL tell the operator when a change becomes effective, because
neither field applies to anything already running.

The session fields SHALL indicate that they apply to sessions started after the
change. The server field SHALL indicate that it takes effect on the next server
restart, including the in-place restart the panel offers. When the configured
server ceiling differs from the running process's effective ceiling, the panel
SHALL surface that the running value differs.

#### Scenario: Session field states its boundary
- **WHEN** the operator views the session heap fields
- **THEN** the panel SHALL state that the value applies to newly started sessions

#### Scenario: Server field states the restart boundary
- **WHEN** the operator views the server heap field
- **THEN** the panel SHALL state that the value takes effect on the next restart, including the in-place restart

#### Scenario: A configured value that is not yet running is visible
- **WHEN** the configured ceiling differs from the running process's effective ceiling
- **THEN** the panel SHALL surface that the running value differs

## REMOVED Requirements

### Requirement: The server ceiling SHALL be labelled cold-start-only, not restart-required
**Reason**: An in-place restart now applies a changed `serverHeap` ceiling (design D5), so the cold-start-only label and the distinct cold-start save message would misinform. The configured-vs-effective divergence scenario moves to "Heap fields state when they take effect".
**Migration**: A `serverHeap` save shows the generic restart-required message; `settings.coldStartRequired` is removed.

### Requirement: Heap fields state when they take effect
**Reason**: Its server clause required the panel to state that a cold start is required and that the in-place restart does not apply the value; that is now false (design D5). Replaced by "Heap fields SHALL state their effect boundary", which keeps the session clause verbatim.
**Migration**: None.
