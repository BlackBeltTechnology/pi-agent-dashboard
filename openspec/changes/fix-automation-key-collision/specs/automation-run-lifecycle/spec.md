## MODIFIED Requirements

### Requirement: Concurrency policy per automation

When a trigger fires while a prior run for the same automation is still active, behavior SHALL follow the automation's `concurrency` field: `skip` (drop, default), `queue` (start when prior ends), or `parallel` (start immediately).

"The same automation" SHALL mean the same automation definition — the same scope and the same discovered path (absolute and lexically normalized, not canonicalized through symlinks). Two automations that share a name but are defined in different directories SHALL NOT be treated as the same automation: a run of one SHALL NOT count as an active prior run of the other.

#### Scenario: skip drops overlapping fire

- **WHEN** `concurrency: skip` and a run is active at the next fire
- **THEN** no new run SHALL start and the skipped fire SHALL be logged.

#### Scenario: queue defers overlapping fire

- **WHEN** `concurrency: queue` and a run is active at the next fire
- **THEN** a new run SHALL start after the active run ends.

#### Scenario: Same-named automations do not block each other

- **WHEN** two different workspaces each define an automation with the same name and the default `concurrency: skip`
- **AND** a run of one of them is active
- **THEN** a fire of the other SHALL start a run rather than being dropped as an overlapping fire
- **AND** no skip SHALL be logged for it.
