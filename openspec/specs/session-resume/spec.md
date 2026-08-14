## Purpose

Enables resuming and forking ended pi sessions from the dashboard UI, spawning new pi instances with the appropriate CLI flags.
## Requirements
### Requirement: Resume session (continue)
The dashboard SHALL support resuming a session by spawning a new pi instance with `pi --session <session-file-path>`. This continues the same JSONL file and reuses the same pi session ID.

A `continue` resume SHALL be refused when the target `sessionFile` is already
served by a live bridge, under **any** session id — not only when the resumed
session's own id is live. The refusal SHALL be a hard error naming the
already-live session; the server SHALL NOT silently reuse or focus the existing
session, and SHALL NOT spawn a second pi against that session file.

The guard SHALL apply on every resume entry point, and SHALL determine liveness
by the same definition the gateway's contention rule uses — a bridge whose peer
no longer answers SHALL NOT count as live and SHALL NOT block a resume.

#### Scenario: Resume ended session
- **WHEN** the user clicks "Resume" on an ended session that has a `sessionFile` stored
- **THEN** the server SHALL spawn pi with `pi --session <session-file-path>` in the session's cwd via tmux
- **AND** the spawned pi instance SHALL connect via the bridge with the same session ID, setting `hidden = false` and `status = "active"`

#### Scenario: Resume session without session file
- **WHEN** the user tries to resume a session that has no `sessionFile` stored (e.g., pre-migration session)
- **THEN** the server SHALL return an error indicating the session file is unknown

#### Scenario: Resume already active session
- **WHEN** the user tries to resume a session that is currently active
- **THEN** the server SHALL return an error indicating the session is already running

#### Scenario: Resume a session file already served under a different session id
- **WHEN** the user resumes session `A` in `continue` mode
- **AND** session `A`'s `sessionFile` is already served by a live bridge
  registered under a different session id `B`
- **THEN** the server SHALL refuse the resume with an error identifying the
  session file as already live
- **AND** SHALL NOT spawn a pi process for session `A`

#### Scenario: Guard applies on the WebSocket resume path too
- **WHEN** the resume is requested over the WebSocket session-action path rather
  than the REST endpoint
- **THEN** the same session-file refusal SHALL apply

#### Scenario: Zombie owner does not block resume
- **WHEN** the target `sessionFile` is recorded against a session whose bridge
  is gone
- **THEN** the resume SHALL proceed, preserving the existing zombie-resume
  behaviour

#### Scenario: A dead owner does not block resume
- **WHEN** the target `sessionFile` is served by a bridge that neither answers a
  probe nor has a writable TCP socket
- **THEN** that bridge SHALL NOT count as live
- **AND** the resume SHALL NOT be refused on the grounds that the file is live

#### Scenario: A busy owner does block resume
- **WHEN** the target `sessionFile` is served by a bridge that does not answer a
  probe but whose TCP socket is still writable
- **THEN** the bridge SHALL count as live and the resume SHALL be refused,
  consistent with the gateway's contention rule

#### Scenario: A session with no recorded session file cannot match
- **WHEN** a live session has no `sessionFile` recorded
- **THEN** it SHALL NOT cause any resume to be refused

#### Scenario: Fork is unaffected by the session-file guard
- **WHEN** the user forks a session whose `sessionFile` is served by a live
  bridge
- **THEN** the fork SHALL proceed, because it targets a new JSONL file and a new
  session id

### Requirement: Fork session
The dashboard SHALL support forking a session by spawning a new pi instance with `pi --fork <session-file-path>`. This creates a new JSONL file with a new session ID. The server SHALL record a pending fork entry so the new session is placed after its parent in the session order.

#### Scenario: Fork ended session
- **WHEN** the user clicks "Fork" on an ended session that has a `sessionFile` stored
- **THEN** the server SHALL spawn pi with `pi --fork <session-file-path>` in the session's cwd via tmux
- **AND** pi SHALL create a new session with a new ID, which connects via the bridge as a new visible session
- **AND** the original session SHALL remain hidden
- **AND** the server SHALL record a pending fork entry with the parent session's ID and cwd

#### Scenario: Fork active session
- **WHEN** the user clicks "Fork" on an active session
- **THEN** the server SHALL spawn pi with `pi --fork <session-file-path>` in the session's cwd
- **AND** a new independent session SHALL be created without affecting the original
- **AND** the server SHALL record a pending fork entry with the parent session's ID and cwd

### Requirement: Resume/fork protocol messages
The browser SHALL send a `resume_session` message to the server specifying the session ID and mode (`"continue"` or `"fork"`). The browser SHALL include an optional `requestId: string` (UUIDv4) for client-side correlation of the eventual result. The server SHALL look up the session file and spawn pi accordingly.

The server SHALL respond with a `resume_result` message echoing the `requestId` (when provided) and including a `newSessionId: string` field for `mode: "fork"` once the forked session has been correlated to its bridge registration. For `mode: "continue"`, `newSessionId` SHALL be omitted (the sessionId is preserved across the respawn).

For `mode: "fork"`, the implementation MAY surface the new sessionId either by (a) deferring `resume_result` emission until the bridge has registered and including `newSessionId` in that single message, OR (b) emitting `resume_result` immediately on spawn success and relying on the eventual `session_added { spawnRequestId }` broadcast (whose `spawnRequestId` matches the fork's `requestId`) to deliver the new sessionId. Implementations SHALL pick exactly one strategy.

#### Scenario: Continue mode
- **WHEN** the browser sends `resume_session` with `mode: "continue"` and `sessionId`
- **THEN** the server SHALL look up the `session_file` for that session and spawn `pi --session <path>`

#### Scenario: Fork mode
- **WHEN** the browser sends `resume_session` with `mode: "fork"` and `sessionId`
- **THEN** the server SHALL look up the `session_file` for that session and spawn `pi --fork <path>`

#### Scenario: Continue spawn result reported to browser
- **WHEN** the server completes a `mode: "continue"` resume
- **THEN** it SHALL send a `resume_result` to the requesting browser with `success: boolean`, `message: string`, and (when input had `requestId`) the echoed `requestId`
- **AND** the message SHALL NOT include `newSessionId`

#### Scenario: Fork spawn result delivers new sessionId
- **WHEN** the server completes a `mode: "fork"` resume successfully and the new bridge registers
- **THEN** the new (forked) sessionId SHALL be delivered to the browser via EITHER `resume_result.newSessionId` OR `session_added.spawnRequestId` matching the input `requestId`
- **AND** in either case, no cwd-based inference SHALL be required by the client

#### Scenario: Fork failure preserves requestId echo
- **WHEN** the server fails a `mode: "fork"` resume (preflight, spawn-errno, etc.)
- **THEN** it SHALL send `resume_result` with `success: false`, `message: <reason>`, and the echoed `requestId`
- **AND** the message SHALL NOT include `newSessionId`

#### Scenario: Legacy client without requestId
- **WHEN** an older client sends `resume_session` without `requestId`
- **THEN** the server SHALL process the message normally
- **AND** the emitted `resume_result` SHALL NOT include a `requestId` field
- **AND** for `mode: "fork"`, the client SHALL fall back to its previous cwd-based heuristic (existing pre-change behavior)

### Requirement: Resuming flag on session
`DashboardSession` SHALL include an optional `resuming?: boolean` field that indicates the session is being auto-resumed.

#### Scenario: Resuming flag set during auto-resume
- **WHEN** an auto-resume is initiated for an ended session
- **THEN** the session's `resuming` field SHALL be set to `true`
- **AND** `session_updated` SHALL be broadcast with the change

#### Scenario: Resuming flag cleared on success
- **WHEN** the auto-resume completes successfully (prompt flushed to new session)
- **THEN** the old session's `resuming` field SHALL be set to `false`

#### Scenario: Resuming flag cleared on timeout
- **WHEN** the auto-resume times out (30 seconds)
- **THEN** the old session's `resuming` field SHALL be set to `false`
- **AND** `session_updated` SHALL be broadcast

### Requirement: Resuming visual indicator on session card
When a session has `resuming === true`, the session card SHALL display a "Resuming…" indicator.

#### Scenario: Pulsing dot and text
- **WHEN** `session.resuming` is `true`
- **THEN** the session card SHALL show a pulsing yellow status dot (same style as streaming)
- **AND** the `ActivityIndicator` SHALL display "Resuming…" in yellow text

#### Scenario: Resuming takes priority over ended state
- **WHEN** `session.resuming` is `true` and `session.status` is `"ended"`
- **THEN** the resuming indicator SHALL be shown instead of the normal ended appearance (grey dot, no activity)

### Requirement: Resume and Fork buttons disabled during resuming
When a session has `resuming === true`, the Resume and Fork buttons SHALL be disabled.

#### Scenario: Buttons disabled while resuming
- **WHEN** `session.resuming` is `true`
- **THEN** the Resume and Fork buttons SHALL be disabled with reduced opacity (`disabled:opacity-50`)

#### Scenario: Optimistic resuming state on button click
- **WHEN** the user clicks Resume or Fork
- **THEN** the client SHALL set `resuming: true` optimistically on the session
- **AND** buttons SHALL be disabled immediately

#### Scenario: Resuming cleared on failure
- **WHEN** the server returns `resume_result` with `success: false`
- **THEN** the client SHALL clear `resuming` to `false` and re-enable buttons

#### Scenario: Resuming cleared on session activation
- **WHEN** a `session_added` message arrives with `status !== "ended"` for the same cwd
- **THEN** the client SHALL clear `resuming` on any other session in that cwd

### Requirement: Resume affordance in desktop session content header
The desktop `SessionHeader` SHALL render a Resume button and a Fork button in its right-side toolbar when the displayed session has `status === "ended"` AND `sessionFile` is non-empty AND a parent-supplied `onResume` callback is present. Clicking Resume SHALL invoke `onResume("continue")`; clicking Fork SHALL invoke `onResume("fork")`. The buttons SHALL be disabled (non-interactive, visually dimmed) while `session.resuming === true`.

#### Scenario: Buttons render on ended session with session file
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"`, `session.sessionFile` set to a non-empty string, and a non-null `onResume` callback
- **THEN** a green Resume pill and a blue Fork pill SHALL appear in the toolbar
- **AND** the dimmed elapsed-duration text SHALL NOT appear in the same slot

#### Scenario: Buttons hidden on active session
- **WHEN** the desktop `SessionHeader` is rendered with `session.status !== "ended"` (e.g., `"active"`, `"streaming"`, `"idle"`)
- **THEN** neither Resume nor Fork pills SHALL appear in the toolbar
- **AND** the elapsed-duration text SHALL appear as before

#### Scenario: Buttons hidden when session file is missing
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"` but `session.sessionFile` is undefined or empty
- **THEN** neither Resume nor Fork pills SHALL appear

#### Scenario: Buttons hidden when onResume callback is omitted
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"` and `session.sessionFile` set, but the parent omits the `onResume` prop
- **THEN** neither Resume nor Fork pills SHALL appear (opt-in render gate)

#### Scenario: Resume click invokes callback with continue mode
- **WHEN** the user clicks the Resume button in the desktop `SessionHeader`
- **THEN** the parent-supplied `onResume` callback SHALL be invoked exactly once with the argument `"continue"`

#### Scenario: Fork click invokes callback with fork mode
- **WHEN** the user clicks the Fork button in the desktop `SessionHeader`
- **THEN** the parent-supplied `onResume` callback SHALL be invoked exactly once with the argument `"fork"`

#### Scenario: Buttons disabled while resuming
- **WHEN** the desktop `SessionHeader` is rendered with `session.status === "ended"`, `session.sessionFile` set, `onResume` provided, and `session.resuming === true`
- **THEN** both Resume and Fork buttons SHALL render but with the `disabled` attribute set
- **AND** clicking a disabled button SHALL NOT invoke `onResume`

#### Scenario: Mobile path unaffected
- **WHEN** the `SessionHeader` is rendered on a mobile viewport
- **THEN** the existing mobile layout (back-arrow, title, attach, kebab) SHALL render unchanged
- **AND** Resume SHALL continue to be reachable via the existing `MobileActionMenu` kebab entry
- **AND** the new desktop Resume / Fork pills SHALL NOT render on the mobile path

### Requirement: Header Resume reuses existing resume protocol
The desktop `SessionHeader`'s Resume / Fork affordances SHALL NOT introduce any new WebSocket message type, REST endpoint, server-side handler, or session state field. The `onResume` callback wired by `App.tsx` SHALL delegate to the same `handleResumeSession(sessionId, mode)` function used by the sidebar `SessionCard` and the mobile `MobileActionMenu`.

#### Scenario: Header click and sidebar click produce identical server traffic
- **WHEN** the user clicks Resume in the desktop `SessionHeader` for a given ended session
- **AND** for comparison, clicks Resume on the same session's sidebar `SessionCard`
- **THEN** both code paths SHALL send a `resume_session` WebSocket message with identical `sessionId` and `mode` fields
- **AND** the server SHALL handle both invocations through the same `handleResumeSession` browser-message handler with no behavioral divergence

### Requirement: Fork on empty session silently degrades to a fresh spawn
When the browser issues `resume_session { mode: "fork" }` (or the REST endpoint receives an equivalent request) AND the source session's `sessionFile` does not exist on disk, the server SHALL silently degrade to a fresh spawn in the source's `cwd`. The degradation SHALL:

1. Verify `existsSync(session.sessionFile)` returns false BEFORE invoking `spawnPiSession`.
2. If the source session has a non-empty `attachedProposal`, enqueue it in `pendingAttachRegistry` keyed by `session.cwd` so the new spawn inherits the attachment.
3. Invoke `spawnPiSession(session.cwd, { strategy })` with NO `sessionFile` and NO `mode` field — i.e., a fresh spawn rather than a fork or continue.
4. Register the resulting PID + spawnToken in `headlessPidRegistry` exactly as a normal spawn would.
5. Record the requestId↔spawnToken correlation in `pendingClientCorrelations` (when both are present) so the eventual `session_added` carries `spawnRequestId`.
6. Send a `resume_result` (or REST response) with `success: result.success`, an informational `message` explaining the degradation, the echoed `requestId`, and `code: "FORK_DEGRADED_TO_NEW"` (only set on success — failure returns the spawn's own error code if any).

The user-facing message SHALL be along the lines of `"Started a fresh session — the source had no persisted history to fork from."` or equivalently informative text.

The check applies ONLY to `mode: "fork"`. The `mode: "continue"` path SHALL be unchanged.

#### Scenario: Fork on session with no persisted JSONL spawns fresh in same cwd
- **GIVEN** the dashboard has session `S` with `cwd: "/proj"`, `sessionFile: "/proj/.pi/missing.jsonl"`, no `attachedProposal`
- **AND** `existsSync("/proj/.pi/missing.jsonl")` returns false
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "fork", requestId: "rq" }`
- **THEN** the server SHALL invoke `spawnPiSession("/proj", { strategy })` (no sessionFile, no mode)
- **AND** SHALL emit `resume_result { sessionId: "S", success: true, code: "FORK_DEGRADED_TO_NEW", requestId: "rq", message: <fresh-session-message> }` once spawn succeeds
- **AND** SHALL register the new PID in `headlessPidRegistry`
- **AND** SHALL record the requestId↔spawnToken correlation
- **AND** the legacy `pendingForkRegistry.recordFork(token, parentSessionId)` SHALL NOT be called for this path
- **AND** no spawn-failure-log entry SHALL be appended

#### Scenario: Degraded fork inherits parent's attachedProposal
- **GIVEN** session `S` has `attachedProposal: "feature-x"` and `existsSync(sessionFile)` is false
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "fork" }`
- **THEN** the server SHALL enqueue `("feature-x", S.cwd)` in `pendingAttachRegistry` BEFORE calling `spawnPiSession`
- **AND** when the new pi process registers, the existing pending-attach pipeline SHALL apply `feature-x` to the new session

#### Scenario: REST fork on missing JSONL returns 200 with degradation code
- **WHEN** an HTTP client posts `{ "mode": "fork" }` to `/api/session/:id/resume` for a session whose `sessionFile` does not exist on disk
- **THEN** the server SHALL respond with HTTP 200 and body `{ success: true, data: { message: <fresh-session-message> }, code: "FORK_DEGRADED_TO_NEW" }`
- **AND** SHALL NOT respond with HTTP 409 or any 4xx/5xx for this case

#### Scenario: Fork on session with persisted JSONL is unaffected
- **GIVEN** session `S` whose `sessionFile` exists on disk
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "fork" }`
- **THEN** the server SHALL invoke the existing fork flow (`pi --fork <path>`, `pendingForkRegistry.recordFork`, etc.)
- **AND** the response code SHALL NOT include `FORK_DEGRADED_TO_NEW`

#### Scenario: Continue mode is unaffected by the degradation
- **WHEN** the browser sends `resume_session { sessionId: "S", mode: "continue" }`
- **THEN** the new fork preflight SHALL NOT run
- **AND** existing continue-mode validation (session is ended, sessionFile is set) SHALL apply as before

#### Scenario: Spawn failure on degraded path surfaces normally
- **GIVEN** the server takes the degraded path AND `spawnPiSession` returns `{ success: false, message: <reason>, code: "DIR_MISSING" }`
- **WHEN** the response is sent
- **THEN** `resume_result.success` SHALL be `false`
- **AND** `resume_result.message` SHALL carry the spawn failure message
- **AND** `resume_result.code` SHALL NOT be `"FORK_DEGRADED_TO_NEW"` (the degradation didn't complete)

### Requirement: `resume_result` carries optional `code` field
The `ResumeResultBrowserMessage` (server → browser) SHALL include an optional `code?: string` field. When set, it SHALL be a structured failure-or-status classifier string. Known values include `"FORK_DEGRADED_TO_NEW"` for the silent-degradation path. Old clients that do not read the field SHALL continue to function on the existing `message` string alone.

```ts
export interface ResumeResultBrowserMessage {
  type: "resume_result";
  sessionId: string;
  success: boolean;
  message: string;
  requestId?: string;
  newSessionId?: string;
  code?: string; // NEW
}
```

#### Scenario: Code field type-checks
- **WHEN** the protocol type is referenced in TypeScript
- **THEN** `code: string | undefined` SHALL be allowed on `ResumeResultBrowserMessage`

#### Scenario: Old clients ignore the code
- **WHEN** an older client (pre-this-change) receives `resume_result` with a `code` field
- **THEN** it SHALL parse and process the message normally, using only `message` and `success` for display

### Requirement: `ApiResponse` REST envelope carries optional `code` field
The `ApiResponse` shared envelope SHALL include an optional `code?: string` field so REST handlers can emit structured codes alongside `error`/`success`.

```ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string; // NEW
}
```

#### Scenario: REST endpoint emits a structured code
- **WHEN** `/api/session/:id/resume` takes the degradation path on success
- **THEN** the response body SHALL include `code: "FORK_DEGRADED_TO_NEW"`

#### Scenario: REST clients without code awareness still work
- **WHEN** an older REST client parses the response
- **THEN** it SHALL read `success` and `data.message` as before; the extra `code` SHALL not cause parse failures

