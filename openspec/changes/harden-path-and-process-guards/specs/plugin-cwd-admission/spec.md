## MODIFIED Requirements

### Requirement: Automation and flows plugin routes admit the request cwd
A `cwd` on any automation route or `/flow-inputs` SHALL be admitted tri-state (403/503) before scope resolution or filesystem/git access, in every scope. A missing `cwd` SHALL get 400 `cwd_required` on folder-scope automation routes (the default, incl. generated MCP tools) and `/flow-inputs`; global scope needs none. The MCP tool manifest SHALL mark `cwd` required for folder-scope tools (create, update, delete, definition, runs, result only). A non-string `cwd` SHALL get 400 `invalid_cwd`.
The automation `plugin_action` `create` and `run` actions SHALL apply the same shape and admission checks to `payload.cwd` (a non-string value is refused), and `create` SHALL also apply the presence check on folder scope with no fallback to the server process cwd; `run` with no `payload.cwd` is unchanged. A refused action SHALL write nothing and start no run.

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

#### Scenario: plugin_action create with an unadmitted cwd writes nothing
- **WHEN** a browser `plugin_action` `{ pluginId: "automation", action: "create" }` carries folder scope and a `payload.cwd` that is not admitted
- **THEN** the handler SHALL log a refusal and SHALL NOT create `<cwd>/.pi/automation/<name>/`

#### Scenario: plugin_action create without a cwd is refused
- **WHEN** a folder-scope `plugin_action` `create` carries no `payload.cwd` (or an empty or non-string one)
- **THEN** the handler SHALL refuse it and SHALL NOT write under the server process cwd

#### Scenario: plugin_action create for an admitted cwd still writes
- **WHEN** a folder-scope `plugin_action` `create` carries an admitted `payload.cwd` and a valid name and config
- **THEN** `<cwd>/.pi/automation/<name>/automation.yaml` SHALL be written and the admission token released afterwards

#### Scenario: plugin_action create with global scope needs no cwd
- **WHEN** a `plugin_action` `create` names `scope: "global"` and no cwd
- **THEN** it SHALL write under the home-directory scope as before

#### Scenario: plugin_action run with a non-string cwd starts nothing
- **WHEN** a `plugin_action` `run` carries a `payload.cwd` that is a number, object or array
- **THEN** the handler SHALL refuse it and SHALL NOT scan any cwd or start a run

#### Scenario: plugin_action run without a cwd is unchanged
- **WHEN** a `plugin_action` `run` carries no `payload.cwd`
- **THEN** its behavior SHALL be unchanged from before this requirement

#### Scenario: plugin_action run with an unadmitted cwd starts nothing
- **WHEN** a `plugin_action` `run` carries a `payload.cwd` that is not admitted
- **THEN** the handler SHALL log a refusal and SHALL NOT scan that cwd or start a run

#### Scenario: Indeterminate admission refuses the plugin_action
- **WHEN** admission for a `plugin_action` `create` or `run` is `indeterminate`
- **THEN** the handler SHALL refuse it, writing nothing and starting no run
