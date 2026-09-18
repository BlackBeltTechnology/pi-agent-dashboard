## ADDED Requirements

### Requirement: Memory fields on the Sessions and Server pages

The settings panel SHALL expose the heap configuration: the `sessionHeap` fields
on the Sessions page and the `serverHeap` field on the Server page.

Both top-level keys SHALL be registered in the settings field-to-page mapping,
and the save payload computation SHALL include them, so a change is attributed
to the right page and is actually persisted.

Each field SHALL state the unit (megabytes) and its effective default.

#### Scenario: Session heap edit is attributed to the Sessions page
- **WHEN** the operator edits `sessionHeap.maxOldSpaceMb`
- **THEN** the unsaved-changes indicator SHALL attribute the change to the Sessions page

#### Scenario: Server heap edit is attributed to the Server page
- **WHEN** the operator edits `serverHeap.maxOldSpaceMb`
- **THEN** the unsaved-changes indicator SHALL attribute the change to the Server page

#### Scenario: Heap edits survive save
- **WHEN** the operator changes a heap field and saves
- **THEN** the save payload SHALL include the changed key
- **AND** reloading the settings panel SHALL show the saved value

### Requirement: Heap fields state when they take effect

Each heap field SHALL tell the operator when a change becomes effective, because
neither field applies to anything already running.

The session fields SHALL indicate that they apply to sessions started after the
change. The server field SHALL indicate that it requires a cold start and does
not take effect on an in-place restart.

#### Scenario: Session field states its boundary
- **WHEN** the operator views the session heap fields
- **THEN** the panel SHALL state that the value applies to newly started sessions

#### Scenario: Server field states the cold-start requirement
- **WHEN** the operator views the server heap field
- **THEN** the panel SHALL state that a cold start is required

### Requirement: Out-of-range heap input is refused at entry

The panel SHALL refuse a `maxOldSpaceMb` value below the supported floor of
`64`, and SHALL warn on a value above `8192` rather than refusing it.

Refusal at entry SHALL NOT be the only protection: an out-of-range value that
reaches the config by any other route still falls back to the default at load
time.

#### Scenario: Below-floor entry is refused
- **WHEN** the operator enters `16` for a `maxOldSpaceMb` field
- **THEN** the panel SHALL refuse the value and explain the floor

#### Scenario: Unusually large entry is warned, not blocked
- **WHEN** the operator enters a value above `8192`
- **THEN** the panel SHALL warn
- **AND** the value SHALL remain saveable

### Requirement: The panel SHALL disclose the heap/fan-out coupling

`Agent` children run inside the parent session's process and share its heap, so
raising the fan-out bound spends session memory that is invisible at the point
of the edit. When the session ceiling and `maxConcurrentSubagents` together
leave each concurrent child under roughly `100` MB
(`maxOldSpaceMb / (maxConcurrentSubagents + 1)`), the panel SHALL surface a
non-blocking warning naming the computed per-child figure.

#### Scenario: Risky pairing is disclosed at the point of edit
- **WHEN** the operator raises `maxConcurrentSubagents` to `8` against a `512` MB ceiling
- **THEN** the panel SHALL warn and name the per-child figure
- **AND** the value SHALL remain saveable

#### Scenario: Default pairing is silent
- **WHEN** the ceiling is `512` and `maxConcurrentSubagents` is the default `2`
- **THEN** no coupling warning SHALL be shown

### Requirement: The panel SHALL disclose the server-heap/store-budget coupling

The same disclosure applies to the server pair. Both keys live on the Server
page, but they multiply into a third quantity — the heap the store will actually
occupy — that neither field displays, so a pairing that guarantees an OOM looks
unremarkable at the point of either edit. When the store budget converted to
heap leaves insufficient room under the server ceiling — including the unlimited
case, `maxTotalEventBytes` of `0` — the panel SHALL surface a non-blocking
warning naming the heap-equivalent figure.

#### Scenario: Unlimited store budget is disclosed
- **WHEN** the operator sets `maxTotalEventBytes` to `0` against the default `1536` MB ceiling
- **THEN** the panel SHALL warn that the store is unbounded under a bounded ceiling
- **AND** the value SHALL remain saveable

#### Scenario: Warning names the heap-equivalent, not the budget
- **WHEN** the operator raises `maxTotalEventBytes` to `2048` MiB against a `1536` MB ceiling
- **THEN** the warning SHALL report the budget's heap-equivalent rather than the raw budget

#### Scenario: Unlimited budget is described as unbounded, not as a figure
- **WHEN** `maxTotalEventBytes` is `0`
- **THEN** the warning SHALL describe the store as unbounded rather than reporting a heap-equivalent number

### Requirement: The server ceiling SHALL be labelled cold-start-only, not restart-required

`serverHeap.maxOldSpaceMb` does not take effect on the in-place restart the
panel offers, because that restart inherits the current process environment. The
generic "some changes require a server restart" banner therefore tells the
operator that an action they can take is sufficient, when it provably is not.
The panel SHALL distinguish this field, and the effective ceiling SHALL be
observable so a divergence between configured and running value is visible.

#### Scenario: Editing the server ceiling states the stronger requirement
- **WHEN** the operator edits `serverHeap.maxOldSpaceMb`
- **THEN** the panel SHALL state that a full cold start is required
- **AND** it SHALL NOT imply the in-place restart applies the new ceiling

#### Scenario: A configured value that is not yet running is visible
- **WHEN** the configured ceiling differs from the running process's effective ceiling
- **THEN** the panel SHALL surface that the running value differs

#### Scenario: Default server pairing is silent
- **WHEN** `maxTotalEventBytes` is the default `768` MiB and the ceiling is the default `1536`
- **THEN** no coupling warning SHALL be shown
