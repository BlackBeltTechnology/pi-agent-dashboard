## ADDED Requirements

### Requirement: Load session events protocol messages
The shared protocol SHALL define new message types for on-demand session loading between server and bridge extension.

Server → Extension:
- `load_session_events`: request to load a session file and replay its events. Fields: `sessionId` (string), `sessionFile` (string).

Extension → Server:
- `load_session_events_result`: contains all loaded events for the requested session. Fields: `sessionId` (string), `events` (array of `{ eventType, timestamp, data }`).
- `load_session_events_error`: signals that loading failed. Fields: `sessionId` (string), `error` (string).

#### Scenario: Message type definitions
- **WHEN** the protocol types are compiled
- **THEN** `LoadSessionEventsMessage`, `LoadSessionEventsResultMessage`, and `LoadSessionEventsErrorMessage` SHALL be valid TypeScript interfaces with the specified fields

#### Scenario: Union type inclusion for server-to-extension
- **WHEN** `ServerToExtensionMessage` union is checked
- **THEN** it SHALL include `LoadSessionEventsMessage`

#### Scenario: Union type inclusion for extension-to-server
- **WHEN** `ExtensionToServerMessage` union is checked
- **THEN** it SHALL include `LoadSessionEventsResultMessage` and `LoadSessionEventsErrorMessage`

### Requirement: Session heartbeat protocol
The bridge extension SHALL send `session_heartbeat` messages at a fixed interval (15 seconds) to keep the session alive on the server. The server SHALL maintain a heartbeat timeout (45 seconds) per connected session. If no heartbeat is received within the timeout, the server SHALL unregister the session.

The server SHALL implement sleep-aware heartbeat detection: if the elapsed wall-clock time since the timer was set exceeds 2× the expected timeout (indicating system sleep/wake), the server SHALL grant one grace period (reset the timer) instead of immediately unregistering.

Extension → Server:
- `session_heartbeat`: keepalive signal. Fields: `sessionId` (string), optional `metrics` (ProcessMetrics).

#### Scenario: Normal heartbeat
- **WHEN** the bridge sends heartbeats every 15 seconds
- **THEN** the server SHALL keep the session registered

#### Scenario: Heartbeat timeout
- **WHEN** no heartbeat is received for 45 seconds (and no sleep detected)
- **THEN** the server SHALL unregister the session

#### Scenario: Sleep-wake grace period
- **WHEN** the heartbeat timer fires after system wake (elapsed time > 2× timeout)
- **THEN** the server SHALL reset the timer once, giving the bridge time to reconnect

#### Scenario: Grace period exhausted
- **WHEN** the timer fires again after the grace period and still no heartbeat
- **THEN** the server SHALL unregister the session

### Requirement: Session data unavailability flag
The `DashboardSession` type SHALL include an optional `dataUnavailable` boolean field. When a browser subscribes to a session whose events cannot be loaded (no bridge available or load timeout), the server SHALL send a `session_updated` with `{ dataUnavailable: true }`.

#### Scenario: Data unavailable broadcast
- **WHEN** a browser subscribes to an evicted session and no bridge is available
- **THEN** the server SHALL send `session_updated` with `{ dataUnavailable: true }` so the browser can show an appropriate indicator

#### Scenario: Data unavailable on load timeout
- **WHEN** an on-demand load request times out after 10 seconds
- **THEN** the server SHALL send `session_updated` with `{ dataUnavailable: true }` to all waiting browsers

#### Scenario: Data becomes available
- **WHEN** a bridge connects and replays events for a previously unavailable session
- **THEN** the server SHALL send `session_updated` with `{ dataUnavailable: false }`

### Requirement: Attach proposal browser message
The browser→server protocol SHALL include an `attach_proposal` message type with fields `sessionId: string` and `changeName: string`. This type SHALL be a member of the `BrowserToServerMessage` union type.

#### Scenario: Attach proposal message sent
- **WHEN** the browser sends `{ type: "attach_proposal", sessionId: "s1", changeName: "add-auth" }`
- **THEN** the server SHALL process the attachment and broadcast a `session_updated` with `attachedProposal: "add-auth"`

### Requirement: Detach proposal browser message
The browser→server protocol SHALL include a `detach_proposal` message type with field `sessionId: string`. This type SHALL be a member of the `BrowserToServerMessage` union type.

#### Scenario: Detach proposal message sent
- **WHEN** the browser sends `{ type: "detach_proposal", sessionId: "s1" }`
- **THEN** the server SHALL process the detachment and broadcast a `session_updated` with `attachedProposal: null`

### Requirement: Bash output and command feedback event types
The `DashboardEvent` type SHALL accept `bash_output` and `command_feedback` as valid `eventType` values. These events flow through the existing `event_forward` (extension→server) and `event` (server→browser) message pipeline with no new message types required.

`bash_output` event data shape:
- `command`: string
- `output`: string
- `exitCode`: number
- `excludeFromContext`: boolean

`command_feedback` event data shape:
- `command`: string
- `status`: `"started"` | `"completed"` | `"error"`
- `message?`: string

#### Scenario: Bash output event flows through pipeline
- **WHEN** the extension sends an `event_forward` with a `bash_output` event
- **THEN** the server SHALL store it in the event buffer and forward it to subscribed browsers as an `event` message

#### Scenario: Command feedback event flows through pipeline
- **WHEN** the extension sends an `event_forward` with a `command_feedback` event
- **THEN** the server SHALL store it in the event buffer and forward it to subscribed browsers as an `event` message

### Requirement: Terminal session source type
The `SessionSource` type SHALL include `"terminal"` as a valid union member alongside existing values (`"interactive"`, `"headless"`, `"sdk"`).

#### Scenario: Terminal source type compiles
- **WHEN** the shared types are compiled
- **THEN** `SessionSource` SHALL accept `"terminal"` as a valid value

### Requirement: Set model protocol message (server→extension)
The server→extension protocol SHALL include a `set_model` message type with fields: `sessionId` (string), `provider` (string), `modelId` (string).

#### Scenario: Message type definition
- **WHEN** the protocol types are compiled
- **THEN** `SetModelMessage` SHALL be a valid TypeScript interface with `type: "set_model"`, `sessionId`, `provider`, and `modelId` fields

#### Scenario: Union type inclusion
- **WHEN** `ServerToExtensionMessage` union is checked
- **THEN** it SHALL include `SetModelMessage`

### Requirement: Set model browser protocol message (browser→server)
The browser→server protocol SHALL include a `set_model` message type with fields: `sessionId` (string), `provider` (string), `modelId` (string).

#### Scenario: Message type definition
- **WHEN** the browser protocol types are compiled
- **THEN** `SetModelBrowserMessage` SHALL be a valid TypeScript interface with `type: "set_model"`, `sessionId`, `provider`, and `modelId` fields

#### Scenario: Union type inclusion
- **WHEN** `BrowserToServerMessage` union is checked
- **THEN** it SHALL include `SetModelBrowserMessage`

### Requirement: Set model forwarding
The server SHALL forward `set_model` messages from browser to the bridge extension for the target session.

#### Scenario: Forward to bridge
- **WHEN** the server receives a `set_model` message from a browser
- **THEN** it SHALL send a `set_model` message to the bridge extension for that session

### Requirement: Bridge handles set_model
The bridge extension SHALL handle `set_model` by looking up the model in the registry and calling `pi.setModel(model)`.

#### Scenario: Successful model switch
- **WHEN** the bridge receives `set_model` with a valid provider and modelId
- **THEN** it SHALL find the model via `registry.find(provider, modelId)` and call `pi.setModel(model)`

#### Scenario: Unknown model
- **WHEN** the bridge receives `set_model` with an unrecognized provider/modelId
- **THEN** it SHALL silently ignore the request (no error, no crash)
## ADDED Requirements

### Requirement: Extension UI request message type (extension to server)
The extension→server protocol SHALL define `ExtensionUiRequestMessage` with fields: `type: "extension_ui_request"`, `sessionId` (string), `requestId` (string), `method` (string), `params` (Record<string, unknown>). It SHALL be included in the `ExtensionToServerMessage` union.

#### Scenario: Message type in union
- **WHEN** `ExtensionToServerMessage` union is checked
- **THEN** it SHALL include `ExtensionUiRequestMessage`

### Requirement: Extension UI response message type (server to extension)
The server→extension protocol SHALL define `ExtensionUiResponseMessage` with fields: `type: "extension_ui_response"`, `sessionId` (string), `requestId` (string), `result` (unknown), `cancelled` (optional boolean). It SHALL be included in the `ServerToExtensionMessage` union.

#### Scenario: Message type in union
- **WHEN** `ServerToExtensionMessage` union is checked
- **THEN** it SHALL include `ExtensionUiResponseMessage`

### Requirement: Browser extension UI request message type (server to browser)
The server→browser protocol SHALL define `BrowserExtensionUiRequestMessage` with fields: `type: "extension_ui_request"`, `sessionId` (string), `requestId` (string), `method` (string), `params` (Record<string, unknown>). It SHALL be included in the `ServerToBrowserMessage` union.

#### Scenario: Message type in union
- **WHEN** `ServerToBrowserMessage` union is checked
- **THEN** it SHALL include `BrowserExtensionUiRequestMessage`

### Requirement: Browser extension UI response message type (browser to server)
The browser→server protocol SHALL define `BrowserExtensionUiResponseMessage` with fields: `type: "extension_ui_response"`, `sessionId` (string), `requestId` (string), `result` (unknown), `cancelled` (optional boolean). It SHALL be included in the `BrowserToServerMessage` union.

#### Scenario: Message type in union
- **WHEN** `BrowserToServerMessage` union is checked
- **THEN** it SHALL include `BrowserExtensionUiResponseMessage`

### Requirement: Remove old extension UI event message types
The `ExtensionUiEventMessage` (extension→server) and `BrowserExtensionUiEventMessage` (server→browser) SHALL be removed from the protocol. They SHALL be removed from their respective union types.

#### Scenario: Old extension message type removed
- **WHEN** `ExtensionToServerMessage` union is checked
- **THEN** it SHALL NOT include `ExtensionUiEventMessage`

#### Scenario: Old browser message type removed
- **WHEN** `ServerToBrowserMessage` union is checked
- **THEN** it SHALL NOT include `BrowserExtensionUiEventMessage`

### Requirement: Terminal control browser messages
The `BrowserToServerMessage` union SHALL include `create_terminal` (fields: `cwd: string`), `kill_terminal` (fields: `terminalId: string`), and `rename_terminal` (fields: `terminalId: string`, `title: string`) message types.

#### Scenario: Create terminal message type-checks
- **WHEN** client code sends `{ type: "create_terminal", cwd: "/path" }`
- **THEN** it SHALL compile without `as any` casts

#### Scenario: Kill terminal message type-checks
- **WHEN** client code sends `{ type: "kill_terminal", terminalId: "term-abc" }`
- **THEN** it SHALL compile without `as any` casts

### Requirement: Session management browser messages
The `BrowserToServerMessage` union SHALL include `resume_session` (fields: `sessionId: string`, `mode: "continue" | "fork"`), `spawn_session` (fields: `cwd: string`), `reorder_sessions` (fields: `cwd: string`, `sessionIds: string[]`), and `extension_ui_response` (fields: `sessionId: string`, `requestId: string`, `result?: unknown`, `cancelled?: boolean`) message types.

#### Scenario: Resume session message type-checks
- **WHEN** client code sends `{ type: "resume_session", sessionId: "s1", mode: "fork" }`
- **THEN** it SHALL compile without `as any` casts

#### Scenario: Spawn session message type-checks
- **WHEN** client code sends `{ type: "spawn_session", cwd: "/path" }`
- **THEN** it SHALL compile without `as any` casts

### Requirement: Pinned directory browser messages
The `BrowserToServerMessage` union SHALL include `pin_directory` (fields: `path: string`), `unpin_directory` (fields: `path: string`), and `reorder_pinned_dirs` (fields: `paths: string[]`) message types.

#### Scenario: Pin directory message type-checks
- **WHEN** client code sends `{ type: "pin_directory", path: "/path" }`
- **THEN** it SHALL compile without `as any` casts

### Requirement: DashboardSession currentTool allows null
The `DashboardSession.currentTool` field SHALL be typed as `string | null | undefined` to support explicit clearing via `null` (which survives JSON serialization, unlike `undefined`).

#### Scenario: currentTool set to null
- **WHEN** the server sends `session_updated` with `{ currentTool: null }`
- **THEN** the browser SHALL receive `null` (not `undefined`) after JSON deserialization
- **AND** the session card SHALL clear any tool indicator
## ADDED Requirements

### Requirement: Flow control message type in extension protocol
The extension protocol SHALL define a `flow_control` message type from server to extension for flow-specific commands.

The message SHALL have the shape:
```
{ type: "flow_control", sessionId: string, action: "abort" | "toggle_autonomous" }
```

#### Scenario: Flow control message in ServerToExtensionMessage union
- **WHEN** the protocol types are compiled
- **THEN** `FlowControlExtensionMessage` SHALL be a valid member of `ServerToExtensionMessage`

### Requirement: Flow event types recognized in event forwarding
The event forwarding pipeline SHALL pass through flow-specific `eventType` values without modification: `flow_started`, `flow_agent_started`, `flow_agent_complete`, `flow_tool_call`, `flow_tool_result`, `flow_assistant_text`, `flow_thinking_text`, `flow_loop_iteration`, `flow_auto_decision`, `flow_complete`.

#### Scenario: Flow events stored and broadcast
- **WHEN** an `event_forward` message has `eventType` starting with `flow_`
- **THEN** the server SHALL store it in the memory event store and broadcast it to subscribed browsers as an `EventMessage`

### Requirement: Flow control message type in browser protocol
The browser protocol SHALL define a `flow_control` message type from browser to server.

The message SHALL have the shape:
```
{ type: "flow_control", sessionId: string, action: "abort" | "toggle_autonomous" }
```

#### Scenario: Flow control in BrowserToServerMessage union
- **WHEN** the protocol types are compiled
- **THEN** `FlowControlBrowserMessage` SHALL be a valid member of `BrowserToServerMessage`

### Requirement: Server to extension heartbeat acknowledgment
The `ServerToExtensionMessage` union type SHALL include a `HeartbeatAckMessage` type for server-to-extension heartbeat acknowledgments.

#### Scenario: Heartbeat ack message defined
- **WHEN** the server receives a `session_heartbeat` from the bridge
- **THEN** it SHALL respond with `{ type: "heartbeat_ack" }` on the same WebSocket connection

#### Scenario: Type union includes heartbeat_ack
- **WHEN** a developer references `ServerToExtensionMessage`
- **THEN** the union SHALL include `HeartbeatAckMessage` with `type: "heartbeat_ack"`

### Requirement: Process list message (extension → server)
The protocol SHALL define a `process_list` message type for ExtensionToServerMessage. Fields: `type: "process_list"`, `sessionId` (string), `processes` (array of `{ pid: number, pgid: number, command: string, elapsedMs: number }`).

The per-process entry MAY additionally carry the optional classification fields `kind` (`"task" | "sub-session" | "pi-worker" | "plugin"`), `label` (string), and `sessionRef` (string). The bridge is not required to populate these; classification is the server's responsibility. When absent, consumers SHALL treat the entry as `kind: "task"` with `label` equal to `command`.

#### Scenario: Bridge sends raw entries
- **WHEN** the bridge forwards scanned processes
- **THEN** each entry SHALL contain at least `pid`, `pgid`, `command`, and `elapsedMs`
- **AND** the classification fields MAY be omitted

### Requirement: Kill process message from server to extension
The protocol SHALL define a `kill_process` message type for ServerToExtensionMessage. Fields: `type: "kill_process"`, `sessionId` (string), `pgid` (number).

#### Scenario: Message type definition
- **WHEN** the protocol types are compiled
- **THEN** `KillProcessMessage` SHALL be a valid TypeScript interface in the `ServerToExtensionMessage` union

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

### Requirement: Kill process request message from browser to server
The browser protocol SHALL define a `kill_process` message type for BrowserToServerMessage. Fields: `type: "kill_process"`, `sessionId` (string), `pgid` (number).

#### Scenario: Message type definition
- **WHEN** the browser protocol types are compiled
- **THEN** `KillProcessRequestMessage` SHALL be a valid TypeScript interface in the `BrowserToServerMessage` union


### Requirement: Remove openspec_activity_update from ExtensionToServerMessage
The `OpenSpecActivityUpdateMessage` type SHALL be removed from the `ExtensionToServerMessage` union. The server detects OpenSpec activity directly from forwarded `tool_execution_start` events.

#### Scenario: openspec_activity_update not in union
- **WHEN** the protocol types are compiled
- **THEN** `ExtensionToServerMessage` SHALL NOT include `OpenSpecActivityUpdateMessage`

### Requirement: Remove stats_update from ExtensionToServerMessage
The `StatsUpdateMessage` type SHALL be removed from the `ExtensionToServerMessage` union. The server extracts stats directly from forwarded `turn_end` events.

#### Scenario: stats_update not in union
- **WHEN** the protocol types are compiled
- **THEN** `ExtensionToServerMessage` SHALL NOT include `StatsUpdateMessage`

### Requirement: session_register registerReason field
The `session_register` extension-to-server protocol message SHALL include an optional `registerReason: "spawn" | "reattach"` field. The bridge SHALL set this field to:

- **`"spawn"`** for the very first `session_register` after the bridge process boots, and for every `session_register` emitted by `handleSessionChange` (the new/fork/resume path that mints a fresh `sessionId`).
- **`"reattach"`** for every subsequent `sendStateSync` invocation triggered by a WebSocket reconnect to the dashboard server (i.e. the dashboard restarted while the bridge process kept running).

The bridge SHALL track this via a `hasRegisteredOnce` boolean on `BridgeContext`. The flag SHALL flip from `false` to `true` exactly once per bridge process — on the first `sendStateSync` call after process boot — and SHALL remain `true` for the rest of the process lifetime regardless of session-change events.

When the field is absent (legacy bridge), the server SHALL treat the message as if `registerReason: "spawn"` was specified, preserving pre-existing behavior.

#### Scenario: First sendStateSync after boot tags spawn
- **WHEN** a fresh bridge process connects to the dashboard for the first time and `sendStateSync` runs
- **THEN** the emitted `session_register` SHALL include `registerReason: "spawn"`
- **AND** `BridgeContext.hasRegisteredOnce` SHALL be `true` after the call

#### Scenario: Reconnect after dashboard restart tags reattach
- **WHEN** the dashboard server has restarted and the bridge's WebSocket reconnects, triggering a second `sendStateSync` for the same bridge process
- **THEN** the emitted `session_register` SHALL include `registerReason: "reattach"`

#### Scenario: handleSessionChange always tags spawn
- **WHEN** the user creates a new pi session, forks, or resumes (any path through `handleSessionChange`) — even after the bridge has already reattached once
- **THEN** the emitted `session_register` for the new session id SHALL include `registerReason: "spawn"`

#### Scenario: Legacy bridge omits the field
- **WHEN** a bridge built before this change emits `session_register` without a `registerReason` field
- **THEN** the server SHALL accept the message and behave as if `registerReason: "spawn"` was specified

#### Scenario: Field type is restricted to the two literals
- **WHEN** the protocol type definition is compiled
- **THEN** `SessionRegisterMessage.registerReason` SHALL be typed as `"spawn" | "reattach" | undefined`

## ADDED Requirements

### Requirement: Sessions snapshot message (server to browser)

The server SHALL define a `SessionsSnapshotMessage` in the browser protocol with shape:

```ts
interface SessionsSnapshotMessage {
  type: "sessions_snapshot";
  sessions: DashboardSession[];
  orders: Record<string, string[]>; // cwd → ordered session ids
}
```

This message SHALL be a member of the `ServerToBrowserMessage` union.

#### Scenario: Snapshot type is recognized
- **WHEN** a `ServerToBrowserMessage` with `type: "sessions_snapshot"` is received by a TypeScript-typed consumer
- **THEN** the discriminated union SHALL narrow to `SessionsSnapshotMessage` exposing `sessions` and `orders` fields

#### Scenario: Snapshot carries every known session
- **WHEN** the server constructs a snapshot for a browser connect
- **THEN** `sessions` SHALL contain every entry returned by `sessionManager.listAll()` at construction time, regardless of `status` (alive AND ended)
- **AND** `orders` SHALL contain every cwd whose persisted session order is non-empty

### Requirement: `session_register` carries optional `spawnToken`
The `SessionRegisterMessage` (extension → server) SHALL include an optional `spawnToken?: string` field. The bridge SHALL populate this field with `process.env.PI_DASHBOARD_SPAWN_TOKEN` IFF `bc.hasRegisteredOnce === false` at the time of the register. The bridge SHALL omit the field on every subsequent register (reattach, in-process session change). The server SHALL accept messages where the field is absent and treat them as legacy.

The protocol type SHALL be:

```ts
export interface SessionRegisterMessage {
  type: "session_register";
  sessionId: string;
  cwd: string;
  // ... existing fields ...
  pid?: number;
  registerReason?: "spawn" | "reattach";
  spawnToken?: string; // NEW
}
```

#### Scenario: TypeScript type includes spawnToken
- **WHEN** `SessionRegisterMessage` is referenced in TypeScript
- **THEN** the type SHALL allow `spawnToken: string | undefined`

#### Scenario: First-register message includes spawnToken
- **WHEN** a bridge boots in a pi process where `PI_DASHBOARD_SPAWN_TOKEN` is set and `sendStateSync` runs for the first time
- **THEN** the wire message SHALL contain a `spawnToken` field equal to the env-var value

#### Scenario: Reattach message omits spawnToken
- **WHEN** the bridge reconnects after dashboard restart and resends `session_register`
- **THEN** the wire message SHALL NOT contain a `spawnToken` field

#### Scenario: Legacy bridge produces messages without spawnToken
- **WHEN** an older bridge that pre-dates this change emits `session_register`
- **THEN** the message SHALL parse and process without error
- **AND** the server SHALL fall through to pid-link or cwd-FIFO

### Requirement: `spawn_session` browser message carries optional `requestId`
The `SpawnSessionBrowserMessage` (browser → server) SHALL include an optional `requestId?: string` field. The client SHALL populate this with a freshly-minted UUIDv4 on every dispatch. The server SHALL accept absent values for backwards compatibility.

```ts
export interface SpawnSessionBrowserMessage {
  type: "spawn_session";
  cwd: string;
  attachProposal?: string;
  initialPrompt?: string;
  requestId?: string; // NEW
}
```

#### Scenario: TypeScript type includes requestId
- **WHEN** `SpawnSessionBrowserMessage` is referenced in TypeScript
- **THEN** the type SHALL allow `requestId: string | undefined`

#### Scenario: New client always includes requestId
- **WHEN** the client dispatches `spawn_session` via the upgraded `useSessionActions.handleSpawnSession`
- **THEN** the wire message SHALL contain a `requestId` field with a UUIDv4 value

#### Scenario: Legacy client message accepted
- **WHEN** an older client dispatches `spawn_session` without `requestId`
- **THEN** the server SHALL process the message normally (no echo will be possible, but spawn proceeds)

### Requirement: `resume_session` browser message carries optional `requestId`
The `ResumeSessionBrowserMessage` (browser → server) SHALL include an optional `requestId?: string` field with the same semantics as for `spawn_session`.

```ts
export interface ResumeSessionBrowserMessage {
  type: "resume_session";
  sessionId: string;
  mode: "continue" | "fork";
  entryId?: string;
  placement?: "front" | "keep";
  requestId?: string; // NEW
}
```

#### Scenario: TypeScript type includes requestId
- **WHEN** `ResumeSessionBrowserMessage` is referenced in TypeScript
- **THEN** the type SHALL allow `requestId: string | undefined`

#### Scenario: Resume dispatch always includes requestId
- **WHEN** the upgraded client dispatches `resume_session` for any mode
- **THEN** the wire message SHALL contain a UUIDv4 `requestId` field

### Requirement: `spawn_result` echoes `requestId` and may include `pid`
The `SpawnResultBrowserMessage` (server → browser) SHALL include an optional `requestId?: string` and an optional `pid?: number` field. When the input `spawn_session` carried a `requestId`, the server SHALL echo it. The `pid` SHALL be included when the spawn produced a tracked PID (headless strategy).

```ts
export interface SpawnResultBrowserMessage {
  type: "spawn_result";
  cwd: string;
  success: boolean;
  message: string;
  requestId?: string; // NEW
  pid?: number;       // NEW (informational only)
}
```

#### Scenario: TypeScript type includes requestId and pid
- **WHEN** `SpawnResultBrowserMessage` is referenced in TypeScript
- **THEN** both `requestId: string | undefined` and `pid: number | undefined` SHALL be allowed

#### Scenario: requestId echoed when input had one
- **WHEN** the server processes `spawn_session { cwd: "/p", requestId: "rq_1" }` and emits a result
- **THEN** the emitted `spawn_result` SHALL include `requestId: "rq_1"`

#### Scenario: requestId omitted when input lacked one
- **WHEN** the server processes a legacy `spawn_session` without `requestId`
- **THEN** the emitted `spawn_result` SHALL NOT include a `requestId` field

### Requirement: `resume_result` echoes `requestId` and includes `newSessionId` for fork mode
The `ResumeResultBrowserMessage` (server → browser) SHALL include optional `requestId?: string` and `newSessionId?: string` fields. The `requestId` SHALL be echoed when the input `resume_session` carried one. The `newSessionId` SHALL be populated for `mode: "fork"` ONLY after the forked session's bridge has registered and the server has correlated it via `linkByToken` / `linkByPid` / `linkSession`. For `mode: "continue"`, `newSessionId` SHALL be omitted (the sessionId is unchanged).

The server MAY emit the `resume_result` immediately after `spawnPiSession` returns (without `newSessionId`) and MAY emit a follow-up message — or, alternatively, the client SHALL correlate the new session by `session_added.spawnRequestId`. Implementations SHALL pick exactly one of these two strategies; both MUST surface the new sessionId to the client without requiring cwd-based heuristics.

```ts
export interface ResumeResultBrowserMessage {
  type: "resume_result";
  sessionId: string;
  success: boolean;
  message: string;
  requestId?: string;     // NEW
  newSessionId?: string;  // NEW (fork mode only, populated after link)
}
```

#### Scenario: TypeScript type includes new fields
- **WHEN** `ResumeResultBrowserMessage` is referenced in TypeScript
- **THEN** `requestId: string | undefined` and `newSessionId: string | undefined` SHALL both be allowed

#### Scenario: Continue mode result omits newSessionId
- **WHEN** the server processes `resume_session { mode: "continue" }` and emits a result on success
- **THEN** the emitted `resume_result` SHALL NOT include `newSessionId`

#### Scenario: Fork mode result either populates newSessionId or relies on session_added
- **WHEN** the server processes `resume_session { mode: "fork", requestId: "rq_x" }` successfully
- **THEN** EITHER the emitted `resume_result` SHALL include both `requestId: "rq_x"` and `newSessionId` set to the freshly-minted forked session id (deferred-emit strategy)
- **OR** the client SHALL receive `session_added { session, spawnRequestId: "rq_x" }` carrying the new sessionId (broadcast strategy)
- **AND** in either case, no cwd-based inference SHALL be required

### Requirement: `session_added` browser message includes optional `spawnRequestId`
The `session_added` browser message SHALL include an optional `spawnRequestId?: string` field. The server SHALL populate this field when the new session was correlated to a client-issued `requestId` (via the `pendingClientCorrelations` map). For server-initiated spawns (auto-resume, headless reload, etc.) where no client `requestId` exists, the field SHALL be omitted.

#### Scenario: TypeScript type includes spawnRequestId
- **WHEN** the `session_added` message type is referenced in TypeScript
- **THEN** `spawnRequestId: string | undefined` SHALL be allowed on the message shape

#### Scenario: Browser-spawned session carries spawnRequestId
- **WHEN** a session is created in response to a browser `spawn_session { requestId: "rq_42" }`
- **THEN** the `session_added` broadcast SHALL include `spawnRequestId: "rq_42"`

#### Scenario: Server-spawned session omits spawnRequestId
- **WHEN** auto-resume-on-prompt creates a session (no browser `requestId`)
- **THEN** the `session_added` broadcast SHALL NOT include `spawnRequestId`

#### Scenario: Legacy server omits the field entirely
- **WHEN** a pre-change server emits `session_added`
- **THEN** the message SHALL parse on a new client (the field is optional)
- **AND** the client SHALL NOT crash; auto-select SHALL fall through to no-op
