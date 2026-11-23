# Spec Delta

## Purpose
An agent-callable `flow_open` tool that shows a flow's architecture (graph and node cards) in the dashboard flow slot of the calling session, either a flow the session already knows or a flow definition file the session has not registered.

## ADDED Requirements

### Requirement: The flow_open tool is offered by the flows plugin bridge

A pi session SHALL offer a `flow_open` tool exactly when the dashboard flows plugin bridge is loaded in that session; pi-flows behaviour SHALL be unchanged. When the session has no connection to a dashboard server, a call SHALL return `refused` with reason `unavailable` and SHALL NOT throw. The tool's description SHALL guide the agent to call it after writing, editing or inspecting a flow so the user can see it.

#### Scenario: Bridge loaded offers the tool
- **GIVEN** a pi session with the dashboard flows plugin bridge loaded
- **WHEN** the agent lists its tools
- **THEN** `flow_open` SHALL be present with guidance to show flows after writing or inspecting them

#### Scenario: Flows plugin disabled
- **GIVEN** the dashboard is configured with the flows plugin disabled, so its bridge is not loaded
- **WHEN** a session starts
- **THEN** `flow_open` SHALL NOT be present

#### Scenario: No dashboard server reachable
- **GIVEN** the flows bridge is loaded but the session is not connected to a dashboard server
- **WHEN** the agent calls `flow_open`
- **THEN** the tool SHALL return `refused` with reason `unavailable`

### Requirement: flow_open takes exactly one of a catalog name or a definition path

The tool SHALL accept either `flow` (a catalog flow name `<namespace>:<name>`) or `path` (a flow definition file, or a directory that directly contains `flow.yaml`/`flow.yml`). A call with both or neither, or a `flow` value that is not a valid flow name (empty, longer than 200 characters, or containing `/`, `\`, `..` or control characters), SHALL be refused with reason `invalid-arguments`. A relative `path` SHALL resolve against the calling session's working directory.

#### Scenario: Both or neither argument
- **WHEN** the agent calls `flow_open` with both `flow` and `path`, or with neither
- **THEN** the tool SHALL return `refused` with reason `invalid-arguments`

#### Scenario: Directory containing flow.yaml
- **WHEN** the agent calls `flow_open { path: "packages/engine/flows/invoicebot/process" }` and that directory directly contains `flow.yaml`
- **THEN** the tool SHALL open `packages/engine/flows/invoicebot/process/flow.yaml`

### Requirement: A catalog name opens the catalog flow like the Open picker

A `flow` name SHALL be looked up in the session's flow catalog. When the catalog lacks it, the server SHALL ask the session to rediscover its flows and retry once within the delivery window before refusing with reason `unknown-flow`. A found catalog flow SHALL open exactly as the **Open flow…** picker opens it (runnable).

#### Scenario: Open a catalog flow by name
- **GIVEN** the session's catalog contains `custom:update-dashboard`
- **WHEN** the agent calls `flow_open { flow: "custom:update-dashboard" }`
- **THEN** the session's flow slot SHALL show that flow's not-started panel with **Run** offered

#### Scenario: Cold catalog is refreshed first
- **GIVEN** the server has not yet received the session's catalog, and the session's flows include `custom:update-dashboard`
- **WHEN** the agent calls `flow_open { flow: "custom:update-dashboard" }`
- **THEN** the server SHALL request rediscovery and the flow SHALL open

#### Scenario: Unknown catalog name
- **WHEN** the agent calls `flow_open { flow: "custom:missing" }` and the catalog still lacks it after rediscovery
- **THEN** the tool SHALL return `refused` with reason `unknown-flow` and nothing SHALL be shown

### Requirement: A path is admitted only inside the session working directory

The server SHALL admit a `path` only when its canonical (symlink-resolved) location is a regular file named `flow.yaml` or `flow.yml`, no larger than the flow-file size limit, inside the canonical working directory of the calling session. The admission checks SHALL run before any content is read, and the definition SHALL then be read through the host's guarded file read. Any other path SHALL be refused with reason `path-not-allowed` (outside the working directory) or `not-a-flow` (wrong name, not a regular file, or a directory without a direct `flow.yaml`). A call from a session that is not hub-local SHALL be refused.

#### Scenario: Path inside the working directory
- **GIVEN** a session whose working directory is `/work/app`
- **WHEN** the agent opens `/work/app/packages/engine/flows/invoicebot/process/flow.yaml`
- **THEN** the path SHALL be admitted

#### Scenario: Path outside the working directory
- **WHEN** the agent opens `/etc/flow.yaml` or `../other-repo/flows/x/flow.yaml`
- **THEN** the tool SHALL return `refused` with reason `path-not-allowed`

#### Scenario: Symlink escaping the working directory
- **GIVEN** `/work/app/flows/link` is a symlink to a directory outside `/work/app`
- **WHEN** the agent opens `flows/link/flow.yaml`
- **THEN** the tool SHALL return `refused` with reason `path-not-allowed`

#### Scenario: Non-flow file
- **WHEN** the agent opens a path whose file name is not `flow.yaml` or `flow.yml`
- **THEN** the tool SHALL return `refused` with reason `not-a-flow`

#### Scenario: Remote session
- **GIVEN** a session that is not hub-local
- **WHEN** it calls `flow_open { path }`
- **THEN** the call SHALL be refused and no path SHALL be stored

### Requirement: A directory without a flow lists candidates

When a `path` names a directory inside the working directory that does not directly contain a flow definition, the refusal SHALL include `candidates`: up to 20 `flow.yaml`/`flow.yml` paths beneath it, relative to the session working directory, found without following symlinks, descending at most 6 levels and skipping `node_modules` and `.git`.

#### Scenario: Candidates for a flows root
- **GIVEN** `packages/engine/flows/invoicebot/` holds `process/flow.yaml` and `reconcile/flow.yaml`
- **WHEN** the agent calls `flow_open { path: "packages/engine/flows/invoicebot" }`
- **THEN** the tool SHALL return `refused`, reason `not-a-flow`, with `candidates` containing both paths

#### Scenario: Symlinked subdirectory is not followed
- **GIVEN** a symlinked subdirectory pointing outside the working directory contains a `flow.yaml`
- **WHEN** the agent opens the parent directory
- **THEN** that `flow.yaml` SHALL NOT appear in `candidates`

### Requirement: A path equal to a catalog definition opens the catalog flow

When an admitted definition is the same file as a catalog flow's definition (comparing canonical paths, with the catalog source resolved against the session working directory), the flow SHALL open as that catalog flow (runnable), not as a path-opened flow.

#### Scenario: Path equals a catalog flow's definition
- **GIVEN** catalog flow `custom:notes-to-issues` is defined by `.pi/flows/flows/custom/notes-to-issues/flow.yaml`
- **WHEN** the agent calls `flow_open { path: ".pi/flows/flows/custom/notes-to-issues" }`
- **THEN** the flow SHALL open as the catalog flow `custom:notes-to-issues`, with **Run** offered

### Requirement: An admitted path makes only that flow's own files readable

Admitting a path SHALL make readable, for the calling session only: the definition file, the code handler files its code steps would run, and agent files of agents the definition names that the session's reported agents already resolve, each only when its canonical location is inside the session working directory. Each read through the flows plugin file route SHALL re-check that the file's canonical location is unchanged and still inside the working directory. The flow panel SHALL fetch a path-opened flow's files only through the flows plugin file route; general host file routes keep their existing admission and are not extended by `flow_open`. Admitted files SHALL stay readable until the session ends or the server restarts, and SHALL survive the session re-reporting its catalog files. The UI SHALL receive the path-opened flow's handler and agent file map so node cards can open them.

#### Scenario: Only the flow's own files
- **GIVEN** a path-opened flow with code step `load` and no `target`
- **WHEN** the UI requests `<flowDir>/load.ts`
- **THEN** the flows plugin file route SHALL serve it
- **AND** a request to the flows plugin file route for `<flowDir>/_lib.ts`, which no step names, SHALL be refused

#### Scenario: Handler target outside the working directory
- **GIVEN** a path-opened flow whose code step declares `target: ../../outside/secret.ts`
- **WHEN** the UI requests that handler
- **THEN** it SHALL be refused

#### Scenario: File swapped for a symlink after admission
- **GIVEN** a path-opened flow was admitted
- **WHEN** its `flow.yaml` is replaced by a symlink to a file outside the working directory and the UI requests it
- **THEN** the request SHALL be refused

#### Scenario: Other sessions unaffected
- **GIVEN** session S1 admitted a path-opened flow
- **WHEN** session S2 requests that flow's definition file
- **THEN** the request SHALL be refused

#### Scenario: Re-report keeps admitted files
- **GIVEN** session S admitted a path-opened flow
- **WHEN** S's bridge re-reports its catalog flow files
- **THEN** the path-opened flow's files SHALL stay readable for S

#### Scenario: Node card opens a handler
- **GIVEN** a path-opened flow with code step `load`
- **WHEN** the user opens the `load` node card's source
- **THEN** `<flowDir>/load.ts` SHALL open

### Requirement: flow_open is refused while a flow runs

When the calling session's flow engine reports a flow as running (it has signalled a flow start without a matching completion), `flow_open` SHALL be refused with reason `flow-running` before anything is delivered, because the running flow owns the flow slot.

#### Scenario: Flow running
- **GIVEN** flow `B` is running in session S
- **WHEN** the agent in S calls `flow_open`
- **THEN** the tool SHALL return `refused` with reason `flow-running`

### Requirement: flow_open delivers to every viewing client and reports acknowledgements

The server SHALL send an admitted open request to every connected browser permitted to see the calling session; each SHALL store the attachment for that session only, in its own per-device store, and acknowledge once per connection, whether or not the session is currently on screen (desktop and mobile layouts alike). The attachment SHALL be stamped with the time of the call, so a flow that starts afterwards replaces it. The server SHALL count acknowledgements during a fixed 1.5-second window after sending, and the tool SHALL return:
- `shown` with `acks` (the number of acknowledging connections, one per browser tab) when at least one acknowledged;
- `no-viewer` when none acknowledged in the window, stating that no viewer confirmed the pin (also the result where identity rules let no browser see the session);
- `refused` with a reason (`invalid-arguments`, `unknown-flow`, `not-a-flow`, `path-not-allowed`, `flow-running`, `rate-limited`, `unavailable`), plus `candidates` for `not-a-flow` on a directory.
A successful result SHALL include the flow's display name, its definition path relative to the session working directory, and whether it is view-only. The tool SHALL never throw.

#### Scenario: One viewer connected
- **GIVEN** one browser tab shows session S
- **WHEN** the agent in S calls `flow_open` with an admitted path
- **THEN** that tab's flow slot SHALL show the flow
- **AND** the tool SHALL return `shown` with `acks: 1` and `viewOnly: true`

#### Scenario: No viewer connected
- **GIVEN** no browser is connected
- **WHEN** the agent in S calls `flow_open`
- **THEN** the tool SHALL return `no-viewer` after the 1.5-second window

#### Scenario: Desktop and phone both viewing
- **GIVEN** a desktop browser and a phone both have session S open
- **WHEN** the agent in S calls `flow_open`
- **THEN** both SHALL show the flow, each storing its own attachment, and the tool SHALL return `shown` with `acks: 2`

#### Scenario: Only the calling session is targeted
- **GIVEN** a browser lists sessions S1 and S2
- **WHEN** the agent in S1 calls `flow_open`
- **THEN** only S1's flow slot SHALL change

#### Scenario: A flow started after the pin replaces it
- **GIVEN** the agent pinned flow `A` in session S while S's panel was not on screen
- **WHEN** flow `B` starts in S and the user then opens S
- **THEN** S's flow slot SHALL show `B`, not `A`

#### Scenario: Read-only viewer still acknowledges
- **GIVEN** a browser connected with observe-only rights shows session S
- **WHEN** the agent in S calls `flow_open`
- **THEN** that browser SHALL show the flow and its acknowledgement SHALL be counted

#### Scenario: Repeated calls are rate-limited
- **WHEN** the agent in session S calls `flow_open` more than 10 times within 10 seconds
- **THEN** the calls beyond the limit SHALL return `refused` with reason `rate-limited`

### Requirement: flow_open outcomes are logged

The server SHALL write one log line per `flow_open` call with the session id, the argument kind (`flow` or `path`), the outcome (`shown`/`no-viewer`/`refused`), the refusal reason when refused, and the acknowledgement count. It SHALL NOT log file content.

#### Scenario: Refusal is logged
- **WHEN** a `flow_open` call is refused with `path-not-allowed`
- **THEN** the server log SHALL contain one line naming the session, `path`, `refused` and `path-not-allowed`, and no file content
