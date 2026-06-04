## MODIFIED Requirements

### Requirement: Process list message (extension → server)
The protocol SHALL define a `process_list` message type for ExtensionToServerMessage. Fields: `type: "process_list"`, `sessionId` (string), `processes` (array of `{ pid: number, pgid: number, command: string, elapsedMs: number }`).

The per-process entry MAY additionally carry the optional classification fields `kind` (`"task" | "sub-session" | "pi-worker" | "plugin"`), `label` (string), and `sessionRef` (string). The bridge is not required to populate these; classification is the server's responsibility. When absent, consumers SHALL treat the entry as `kind: "task"` with `label` equal to `command`.

#### Scenario: Bridge sends raw entries
- **WHEN** the bridge forwards scanned processes
- **THEN** each entry SHALL contain at least `pid`, `pgid`, `command`, and `elapsedMs`
- **AND** the classification fields MAY be omitted

### Requirement: Process list update message (server → browser)
The browser protocol SHALL define a `process_list_update` message type for ServerToBrowserMessage. Fields: `type: "process_list_update"`, `sessionId` (string), `processes` (array of `{ pid: number, pgid: number, command: string, elapsedMs: number }`).

Each per-process entry SHALL additionally carry the optional classification fields `kind` (`"task" | "sub-session" | "pi-worker" | "plugin"`), `label` (string), and `sessionRef` (string, the referenced session id for `kind: "sub-session"`). The server SHALL populate `kind` and `label` for every forwarded entry; `sessionRef` SHALL be present only for `sub-session` entries.

#### Scenario: Server forwards classified entries
- **WHEN** the server forwards a process list to subscribed browsers
- **THEN** each entry SHALL include `kind` and `label`
- **AND** `sessionRef` SHALL be present iff `kind` is `"sub-session"`

#### Scenario: Older client ignores classification fields
- **WHEN** a client that predates this change receives a `process_list_update`
- **THEN** it SHALL still read `pid`, `pgid`, `command`, and `elapsedMs` without error
