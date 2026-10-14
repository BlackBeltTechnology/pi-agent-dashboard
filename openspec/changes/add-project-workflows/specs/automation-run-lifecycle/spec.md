## ADDED Requirements

### Requirement: Trusted plugins can start inline automation runs

The automation plugin SHALL provide a service through which another trusted
plugin starts a run from an in-memory definition (action, model, sandbox,
visibility, cwd) without an `automation.yaml`. Such a run SHALL follow the same
spawn, delivery, finalization, stop and retention rules as a file-defined run,
SHALL carry an origin tag naming the calling plugin and its reference (for
example the workflow and change), and SHALL appear in the Automation view's run
list labelled with that origin. Inline runs SHALL NOT create, modify, or appear
as automation definitions. The service SHALL report the run's terminal status to
the caller.

#### Scenario: Workflow starts a headless verify

- **WHEN** the workflows plugin starts an inline run `{ skill: openspec-verify-change, args: add-x, model: @fast }`
- **THEN** a disposable automation session SHALL run it and finalize as usual
- **AND** the Automation view SHALL list the run with origin `workflow: openspec / add-x`
- **AND** no automation definition SHALL be added

#### Scenario: Caller observes completion

- **WHEN** an inline run finalizes
- **THEN** the calling plugin SHALL be notified with the run id, status and result reference
