## ADDED Requirements

### Requirement: File trigger fires once per new file

The trigger registry SHALL register a `file` trigger kind that watches a configured folder and fires exactly once per new file that arrives in it. Each fire SHALL carry a single per-fire value: the absolute path of the file that arrived.

#### Scenario: New file fires once with its path

- **WHEN** a file `inv-042.pdf` arrives in the watched folder `/spool`
- **THEN** the trigger SHALL fire exactly once, and the fire SHALL carry the value `/spool/inv-042.pdf`.

#### Scenario: Each file is an independent fire

- **WHEN** two files `a.pdf` then `b.pdf` arrive in the watched folder
- **THEN** the trigger SHALL fire twice, once per file, each fire carrying its own file path.

### Requirement: File trigger config

An `automation.yaml` `on:` block for the file trigger SHALL accept a `path` (the folder to watch) and the selected events (`created` and/or `changed` and/or `deleted`). Parsing SHALL fail with a diagnostic when `path` is missing or empty, isolating the invalid automation.

#### Scenario: Valid file trigger config parses and arms

- **WHEN** an automation declares `on: { kind: file, path: "/spool", events: [created] }`
- **THEN** the automation SHALL parse and arm a folder watch on `/spool` for the `created` event.

#### Scenario: Missing path is isolated

- **WHEN** an automation declares `on: { kind: file }` with no `path`
- **THEN** parsing SHALL fail with a diagnostic and the automation SHALL be isolated (not armed), without affecting other automations.

### Requirement: Settle avoids partially written files

The file trigger SHALL default to `settle: rename-only`, firing only when a file appears via an atomic rename into the watched folder, so a file still being written is not fired on.

#### Scenario: Rename-only ignores in-progress writes

- **WHEN** `settle: rename-only` is configured and a producer writes to a temp path and then renames it into the watched folder
- **THEN** the trigger SHALL fire only on the rename completion, once, for the settled file.
