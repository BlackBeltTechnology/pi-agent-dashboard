## ADDED Requirements

### Requirement: Per-fire trigger value threaded to the action

A trigger's fire SHALL carry a per-fire value via `FireContext`, and the engine SHALL thread that value from the scheduler through the runner to action dispatch. When the run queue defers a fire (concurrency `queue`), each queued entry SHALL retain its own per-fire context so distinct fires do not collapse to a single value. At dispatch, the token `${{trigger}}` in the action payload SHALL be resolved to the per-fire value.

#### Scenario: Per-fire value reaches the action payload

- **WHEN** a trigger fires with value `/spool/inv-042.pdf` and the action payload contains `${{trigger}}`
- **THEN** the resolved payload delivered to the action SHALL contain `/spool/inv-042.pdf` in place of `${{trigger}}`.

#### Scenario: Queued fires retain distinct values

- **WHEN** a `concurrency: queue` automation fires for `a.pdf` while a prior run is active and then fires for `b.pdf`
- **THEN** the deferred runs SHALL execute in order, the first resolving `${{trigger}}` to `a.pdf` and the second to `b.pdf`.

#### Scenario: Absent trigger value resolves empty

- **WHEN** a trigger fires with no per-fire value and the payload contains `${{trigger}}`
- **THEN** `${{trigger}}` SHALL resolve to an empty string and the run SHALL still start.
