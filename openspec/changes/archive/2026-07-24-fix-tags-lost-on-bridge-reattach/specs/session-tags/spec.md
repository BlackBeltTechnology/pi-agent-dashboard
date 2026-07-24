## ADDED Requirements

### Requirement: Tags survive a bridge reattach

A session's user-owned `tags` SHALL survive a bridge reattach, not only a debounced persistence save and a cold-start scan. When a session that already carries `tags` (e.g. restored from `.meta.json` on cold start) is re-registered by its bridge via `register` with `registerReason: "reattach"`, the rebuilt in-memory `DashboardSession` SHALL carry over the existing `tags`. Because the reattach register triggers the full-overwrite `onChange` persistence save, preserving `tags` in memory SHALL also prevent the reattach from wiping `tags` on disk. A FIRST register (no prior in-memory record) SHALL NOT be affected — it carries no tags by construction and remains untagged until the browser sets them.

#### Scenario: Reattach preserves in-memory tags

- **WHEN** a session carrying `tags: ["feature"]` is re-registered with `registerReason: "reattach"`
- **THEN** the rebuilt in-memory session SHALL still carry `tags: ["feature"]`

#### Scenario: Reattach does not wipe tags on disk

- **GIVEN** a session with `tags: ["feature"]` persisted in its `.meta.json`
- **WHEN** the session's bridge reattaches (`register` with `registerReason: "reattach"`) and the resulting `onChange` full-overwrite save runs
- **THEN** the `.meta.json` SHALL still contain `tags: ["feature"]`

#### Scenario: First register carries no tags

- **WHEN** a session is registered for the first time with no prior in-memory record
- **THEN** the session SHALL carry no tags (absent or empty)
- **AND** no tags from any other session SHALL leak onto it
