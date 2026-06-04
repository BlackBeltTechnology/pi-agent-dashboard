## ADDED Requirements

### Requirement: Server classifies forwarded process-list entries
When the server receives a `process_list` message from a bridge, it SHALL enrich each process entry with a `kind`, a human-readable `label`, and (when applicable) a `sessionRef`, before forwarding as `process_list_update` to subscribed browsers. Classification SHALL be a pure function of the entry's `command` and a `pidIndex` — a map of `pid → { sessionId, name, model }` built from all currently connected sessions' stored `pid` values.

The server SHALL maintain or derive the `pidIndex` from `DashboardSession.pid` (populated from `session_register.pid`). Only sessions currently connected SHALL contribute to the index (avoids pid-reuse mislinks against dead sessions).

#### Scenario: Sub-session named from registry
- **WHEN** a `process_list` entry has a command whose basename is `pi` AND its `pid` is present in `pidIndex`
- **THEN** the entry SHALL be enriched with `kind: "sub-session"`, `label` set to the referenced session's name (falling back to its model when unnamed), and `sessionRef` set to that session's `sessionId`

#### Scenario: Headless pi worker not in registry
- **WHEN** a `process_list` entry has a command whose basename is `pi` AND its `pid` is NOT present in `pidIndex`
- **THEN** the entry SHALL be enriched with `kind: "pi-worker"` and `label: "pi worker"` and no `sessionRef`

#### Scenario: Plugin sidecar named from path
- **WHEN** a `process_list` entry command matches a pi agent plugin path of the form `…/.pi/agent/**/<name>/<file>` (e.g. `bun /Users/x/.pi/agent/npm/node_modules/context-mode/server.bundle.mjs`)
- **THEN** the entry SHALL be enriched with `kind: "plugin"` and `label` set to `<name>` (e.g. `context-mode`)

#### Scenario: Generic user task
- **WHEN** a `process_list` entry matches none of the sub-session, pi-worker, or plugin patterns
- **THEN** the entry SHALL be enriched with `kind: "task"` and `label` set to the original `command` string

#### Scenario: Classification is non-destructive
- **WHEN** any entry is classified
- **THEN** the original `pid`, `pgid`, `command`, and `elapsedMs` fields SHALL be preserved unchanged in the forwarded entry

#### Scenario: Stored processes carry classification for late subscribers
- **WHEN** the server stores the forwarded processes on the session for replay to new subscribers
- **THEN** the stored entries SHALL include the enriched `kind`/`label`/`sessionRef` fields
