# automation-trigger-registry Specification

## Purpose
TBD - created by archiving change add-automation-plugin. Update Purpose after archive.
## Requirements
### Requirement: Extensible trigger registry

The plugin SHALL maintain a trigger registry mapping a trigger `kind` to a `TriggerType` with `parse(rawYaml)` and `arm(cfg, fire): Disposable`. The registry SHALL register `schedule` at boot. The registry SHALL expose a registration path so future core kinds and plugin-provided kinds can be added without changing the on-disk `automation.yaml` format.

#### Scenario: schedule kind registered at boot

- **WHEN** the plugin server entry initializes
- **THEN** the registry SHALL contain a `schedule` trigger type.

#### Scenario: Additional kind registered without format change

- **WHEN** a later registration adds kind `openspec.complete`
- **THEN** an `automation.yaml` with `on.kind: openspec.complete` SHALL parse and arm using the same schema shape (`on.kind` + kind-specific fields), with no migration of existing files.

### Requirement: Central scheduler arms schedule triggers

A single server-owned scheduler SHALL arm every valid automation's trigger. The `schedule` trigger SHALL fire per its cron expression. On config change (create/edit/delete detected via fs.watch on `.pi/automation/`), the scheduler SHALL dispose the affected trigger and re-arm from the new definition.

#### Scenario: Cron fire triggers a run

- **WHEN** a `schedule` automation's cron time arrives
- **THEN** the scheduler SHALL invoke `fire(ctx)` for that automation exactly once for that occurrence.

#### Scenario: Edit re-arms cleanly

- **WHEN** an automation's `automation.yaml` cron changes on disk
- **THEN** the prior armed trigger SHALL be disposed and a new one armed from the updated file, with no duplicate firing.

### Requirement: Restart catch-up is skip

On server restart, the scheduler SHALL recompute each automation's next-fire forward from the current time and SHALL NOT backfill fires missed while the server was down.

#### Scenario: Missed fire not backfilled

- **WHEN** the server was down across a scheduled fire time and then restarts
- **THEN** no run SHALL be created for the missed occurrence, and the next-fire SHALL be the next future cron occurrence.



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
