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
