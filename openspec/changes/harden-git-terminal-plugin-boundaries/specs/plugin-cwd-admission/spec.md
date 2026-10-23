## ADDED Requirements

### Requirement: Automation and flows plugin routes admit the request cwd
A `cwd` on any automation route or `/flow-inputs` SHALL be admitted tri-state (403/503) before scope resolution or filesystem/git access, in every scope. A missing `cwd` SHALL get 400 `cwd_required` on folder-scope automation routes (the default, incl. generated MCP tools) and `/flow-inputs`; global scope needs none. The MCP tool manifest SHALL mark `cwd` required for folder-scope tools (create, update, delete, definition, runs, result only). A non-string `cwd` SHALL get 400 `invalid_cwd`.

#### Scenario: Automation route refuses an unknown cwd
- **WHEN** an automation create, update, delete, run, stop, result, runs, definition, list, actions or git-capable request carries a `cwd` that is not admitted, in any scope
- **THEN** the route SHALL respond `403` with the existing refusal body and SHALL NOT read or write under that cwd

#### Scenario: Missing cwd is refused, not defaulted to the server cwd
- **WHEN** an automation create, update, delete, definition, runs or result-by-run-id request acts on folder scope (explicit or default) without a `cwd`, or with an empty one, or `/flow-inputs` is called without one
- **THEN** it SHALL respond `400` with `error: "cwd_required"` before any admission check
- **AND** it SHALL NOT fall back to the server process cwd as an admitted scope

#### Scenario: Folder-scope MCP automation call without cwd is refused
- **WHEN** an MCP automation tool acting on folder scope is invoked without `cwd`
- **THEN** the route SHALL respond `400` with `error: "cwd_required"` and SHALL NOT use the server process cwd

#### Scenario: MCP tool schemas require cwd for folder-scope tools
- **WHEN** the generated MCP tool manifest is inspected
- **THEN** every folder-scope automation tool SHALL list `cwd` as a required input

#### Scenario: Non-string cwd is refused
- **WHEN** an automation route or `/flow-inputs` is called with a `cwd` that is a number, object or array
- **THEN** it SHALL respond `400` with `error: "invalid_cwd"` and SHALL NOT read or write under any cwd

#### Scenario: Global scope needs no cwd
- **WHEN** an automation create, update, delete, definition, runs or result request names `scope: "global"` and carries no `cwd`
- **THEN** it SHALL proceed against the home-directory scope without a `cwd_required` refusal

#### Scenario: List without cwd lists global only
- **WHEN** `GET /list` is called without a `cwd`
- **THEN** it SHALL list global automations only and SHALL NOT scan the server process cwd

#### Scenario: Git-capable without cwd is false
- **WHEN** `GET /git-capable` is called without a `cwd`
- **THEN** it SHALL respond `{ gitCapable: false }` as before

#### Scenario: Run, stop and actions without cwd are unchanged
- **WHEN** `/run`, `/stop` or `/actions` is called without a `cwd`
- **THEN** its behavior SHALL be unchanged from before this requirement
- **AND** WHEN any of them carries a `cwd`, that `cwd` SHALL be admitted tri-state

#### Scenario: Result lookup by session id without cwd
- **WHEN** `GET /result` is called with a `sessionId` and no `cwd` and no scope
- **THEN** only global scope SHALL be searched, and the server process cwd SHALL NOT be searched

#### Scenario: Indeterminate admission is a 503
- **WHEN** admission for an automation or flows request is `indeterminate`
- **THEN** the route SHALL respond `503 cwd-admission-unavailable` with a `Retry-After` header

#### Scenario: Flows inputs for an unknown cwd are refused
- **WHEN** `/flow-inputs` is called with a `cwd` that is not admitted
- **THEN** the route SHALL respond `403` and SHALL NOT read flow files under it

### Requirement: Automation admit set includes folder-scope contributions
The automation plugin's admit set SHALL be the known folders (sessions, pins) plus the folders contributed through the automation folder-scope axis. Contributions SHALL be read on every request, so a disabled contributor's folders stop being admitted immediately.

#### Scenario: Folder-scope contribution is admitted
- **WHEN** a plugin contributes folder scope `/abs/repo` through the automation folder-scope axis and no session has that cwd
- **THEN** an automation request with `cwd: "/abs/repo"` SHALL be admitted

#### Scenario: Disabled contributor stops being admitted
- **WHEN** the plugin contributing folder scope `/abs/repo` is disabled and no session or pin has that cwd
- **THEN** the next automation request with `cwd: "/abs/repo"` SHALL be refused with `403`

### Requirement: Flow ids cannot traverse
The flows `/flow-inputs` route SHALL refuse a flow id equal to exactly `.` or `..`, or containing a path separator, with HTTP 400 `invalid_flow_id`, before reading any file.

#### Scenario: Flow id traversal is refused
- **WHEN** `/flow-inputs` is called with a flow id of exactly `.` or `..`, or one containing `/` or `\`
- **THEN** the route SHALL respond `400` with `error: "invalid_flow_id"` and SHALL NOT read any file for it

#### Scenario: Dotted flow ids that are not traversal still work
- **WHEN** `/flow-inputs` is called with a flow id such as `team.review` or `a..b`
- **THEN** the id SHALL be accepted

