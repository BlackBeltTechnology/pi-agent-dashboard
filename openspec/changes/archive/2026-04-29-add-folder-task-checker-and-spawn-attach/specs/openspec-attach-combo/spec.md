## ADDED Requirements

### Requirement: spawn_session message accepts optional attachProposal
The `SpawnSessionBrowserMessage` interface in the browser↔server protocol SHALL accept an optional `attachProposal?: string` field. The field SHALL be the kebab-case name of an existing OpenSpec change in the spawn target's `cwd`. Clients omitting the field MUST receive identical behaviour to the field being absent (bare spawn).

#### Scenario: Field is optional and additive
- **WHEN** a client sends `{ type: "spawn_session", cwd: "/project/foo" }` (no `attachProposal`)
- **THEN** the server SHALL spawn a pi session in `/project/foo` exactly as it does today
- **THEN** no attach intent SHALL be queued

#### Scenario: Field carries the change name when present
- **WHEN** a client sends `{ type: "spawn_session", cwd: "/project/foo", attachProposal: "add-auth" }`
- **THEN** the server SHALL spawn a pi session in `/project/foo`
- **THEN** the server SHALL queue a pending-attach intent for `cwd = "/project/foo"`, `changeName = "add-auth"`

#### Scenario: Backward compat — old server, new client
- **WHEN** a new client sending `attachProposal` connects to an old server that ignores unknown fields
- **THEN** the spawn SHALL succeed unattached
- **THEN** the user SHALL be able to attach manually via the existing attach UI

### Requirement: Server queues pending attach intents per cwd
The dashboard server SHALL maintain an in-memory `pendingAttachByCwd: Map<string, PendingAttach[]>` where `PendingAttach = { changeName: string, enqueuedAt: number }`. Receiving a `spawn_session` with `attachProposal` SHALL push to the queue for the normalized cwd. The map SHALL be in-memory only and SHALL NOT be persisted across server restarts.

#### Scenario: Single intent enqueued
- **WHEN** the server handles `spawn_session { cwd: "/project/foo", attachProposal: "add-auth" }`
- **THEN** `pendingAttachByCwd.get("/project/foo")` SHALL contain one entry with `changeName = "add-auth"`

#### Scenario: Multiple intents preserve FIFO order
- **WHEN** the server handles three `spawn_session` calls in order with `attachProposal` values `"a"`, `"b"`, `"c"` for the same cwd
- **THEN** the queue for that cwd SHALL contain `[a, b, c]` in that order

#### Scenario: Cwd is normalized before keying the queue
- **WHEN** two `spawn_session` calls arrive with `cwd = "/project/foo"` and `cwd = "/project/foo/"` (trailing slash) and the same `attachProposal`
- **THEN** both intents SHALL land in the same queue (the path is normalized before lookup)

#### Scenario: Per-cwd queue is bounded
- **WHEN** a 9th `attachProposal` is enqueued for the same cwd while 8 are already queued
- **THEN** the 9th SHALL be silently dropped
- **THEN** the server SHALL log a warning citing the cwd and queue cap

#### Scenario: Stale intents expire after 60 seconds
- **WHEN** an intent has been in the queue for more than 60 seconds and any read or write touches that cwd's queue
- **THEN** the stale entry SHALL be discarded before the operation proceeds
- **THEN** the server SHALL log a warning citing the discarded changeName

### Requirement: Pending intent is consumed on session_register
When the pi-gateway receives a `session_register` from a bridge, after the session is registered with the session manager the server SHALL look up `pendingAttachByCwd` for the registered session's normalized cwd, pop the head entry (if any), and apply the same idempotent attach logic as `handleAttachProposal` — including `attachRenameTarget(...)` rename — to the newly registered `sessionId`.

#### Scenario: Intent matches and is consumed
- **GIVEN** the server has `pendingAttachByCwd.get("/project/foo") = [{changeName: "add-auth", ...}]`
- **WHEN** a `session_register` arrives with `sessionId = "s99"` and `cwd = "/project/foo"`
- **THEN** after `sessionManager.register(...)`, the server SHALL pop the head entry
- **THEN** the server SHALL update the session with `attachedProposal = "add-auth"` and broadcast `session_updated`
- **THEN** if `attachRenameTarget(session, "add-auth")` returns a non-undefined name, the server SHALL also send `rename_session` to the bridge and include `name` in the broadcast

#### Scenario: No intent — no-op
- **GIVEN** the queue for the registering cwd is empty or absent
- **WHEN** a `session_register` arrives
- **THEN** the server SHALL behave exactly as it does today (no attach, no rename)

#### Scenario: Only one intent consumed per register
- **GIVEN** `pendingAttachByCwd.get("/project/foo") = [{changeName: "a", ...}, {changeName: "b", ...}]`
- **WHEN** a single `session_register` for `/project/foo` arrives
- **THEN** only the head entry (`"a"`) SHALL be consumed and applied
- **THEN** `"b"` SHALL remain at the head of the queue for the next matching register

#### Scenario: Cwd normalization on consume
- **GIVEN** an intent was enqueued under the normalized key `/project/foo`
- **WHEN** a `session_register` arrives with cwd `/project/foo/` (trailing slash) or a symlink path resolving to the same realpath
- **THEN** the queue lookup SHALL find and consume the intent

#### Scenario: Failed spawn does not strand the queue forever
- **GIVEN** a spawn failed and no `session_register` ever arrives for that cwd
- **WHEN** 60 seconds elapse and any later intent is enqueued or consumed for that cwd
- **THEN** the stranded intent SHALL be dropped per the staleness rule above
- **THEN** the next successful register SHALL NOT inherit the stranded intent
