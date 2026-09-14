## MODIFIED Requirements

### Requirement: Event-based change extraction
For a local-origin session the server SHALL scan the session's durable transcript (the persisted session record on disk) to extract individual file change events. The volatile in-memory event stream SHALL be used as the scan source only when the transcript does not exist on disk or yields no entries, or when the session originates from a remote host. Each change event SHALL include the timestamp, tool type, and tool-specific data. The change-event `type` SHALL be one of `"edit" | "write" | "tool"`, where `"tool"` denotes a file surfaced by git-status detection or non-git Bash detection rather than a direct Write/Edit call. Each file entry (`FileDiffEntry`) SHALL carry an `origin` of `"write" | "edit" | "tool" | "mixed"`, and MAY carry `producedBy`, `detectedVia`, `sessionOwned`, and a reserved `previewable` flag. The response MAY carry a separate `otherChanges: FileDiffEntry[]` array for git-detected files this session cannot claim. Attribution fields live at the file level; a `"mixed"` file SHALL retain its real Write/Edit change events with NO synthetic `"tool"` event injected.

#### Scenario: Edit tool change
- **WHEN** a `tool_execution_start` event has `toolName` matching "Edit" (case-insensitive)
- **THEN** the change event SHALL include `type: "edit"`, `timestamp`, `path` (from `args.path` or `args.file_path`), and `edits` (array of `{ oldText, newText }` from `args.edits`)

#### Scenario: Write tool change
- **WHEN** a `tool_execution_start` event has `toolName` matching "Write" (case-insensitive)
- **THEN** the change event SHALL include `type: "write"`, `timestamp`, `path` (from `args.path` or `args.file_path`), and `content` (from `args.content`)

#### Scenario: Pure tool-origin file has one representative event
- **WHEN** a file is surfaced only by detection (no Write/Edit event)
- **THEN** its `changes` SHALL contain exactly one event with `type: "tool"`, a non-zero `timestamp` (attributing Bash event time, else file mtime, else request time), and optional `producedBy`

#### Scenario: Duplicate paths grouped
- **WHEN** the same file path appears in multiple tool events
- **THEN** all change events for that path SHALL be grouped under a single file entry, ordered by timestamp

#### Scenario: Context message extraction
- **WHEN** extracting a change event
- **THEN** the server SHALL include a `message` field with a truncated excerpt (max 120 chars) from the most recent assistant `message_end` event preceding the tool call, if available

#### Scenario: Write/Edit events trimmed from the in-memory stream
- **WHEN** a session's in-memory event stream has exceeded its per-session cap and its older Write/Edit `tool_execution_start` events have been trimmed away
- **AND** the session's transcript on disk still records those tool calls
- **THEN** `GET /api/session-diff` SHALL return every file those calls touched as session-owned in `files`
- **AND** those files SHALL NOT appear in `otherChanges`

#### Scenario: Session ran before the current server process started
- **WHEN** a session's tool calls all occurred before the dashboard server last started
- **AND** the session's transcript exists on disk
- **THEN** `GET /api/session-diff` SHALL return the files those calls touched in `files` exactly as it would for a session still resident in memory

#### Scenario: Session evicted from the in-memory store
- **WHEN** a session's events have been evicted from the in-memory store because the tracked-session limit was exceeded
- **AND** the session's transcript exists on disk
- **THEN** `GET /api/session-diff` SHALL return the files its tool calls touched in `files`

#### Scenario: Forked session includes ancestry
- **WHEN** a session's transcript is a branch continuing from a parent entry
- **THEN** the extraction SHALL include Write/Edit calls from the ancestor chain, matching what the session's replay shows

#### Scenario: Transcript-sourced change carries the same context message as the live path
- **WHEN** a transcript records an assistant message containing text and a Write/Edit tool call
- **THEN** that change event's `message` SHALL be the excerpt of *that* assistant message (the one containing the call), not of an earlier message

#### Scenario: Aborted Bash call in an ended session does not claim later edits
- **WHEN** an ended session's transcript contains a Bash call with no recorded result
- **AND** a file in the cwd was modified after the session's last transcript entry
- **THEN** that file SHALL NOT be attributed to the session by Bash-window ownership

#### Scenario: No transcript on disk yet
- **WHEN** a session has no transcript file on disk (freshly spawned, nothing persisted), or the transcript yields no entries (header-only or unreadable)
- **THEN** the server SHALL extract from the in-memory event stream
- **AND** the response shape SHALL be identical to the transcript-sourced path

#### Scenario: Remote session
- **WHEN** the session originates from a remote host
- **THEN** the server SHALL extract from the in-memory event stream exactly as before this change
- **AND** the server SHALL NOT open the session's `sessionFile` path on the local filesystem

### Requirement: Event-loop responsiveness under heavy session diffs

Computing `GET /api/session-diff` for a session with many changed files and/or a very large tracked file SHALL NOT starve other HTTP requests. While a heavy diff is computed, unrelated endpoints (`/api/health`, static `GET /`, settings, prompt submission) SHALL remain responsive. Reading and parsing the session transcript to obtain change events SHALL NOT block the main event loop.

#### Scenario: Health stays responsive while a heavy diff computes
- **WHEN** a session cwd has hundreds of changed files and/or a tracked file larger than 100 MB
- **AND** `GET /api/session-diff` is computing that session's diff
- **THEN** a concurrent `GET /api/health` SHALL respond within a small latency budget (e.g. < 100 ms)
- **AND** the server SHALL NOT be wedged after the diff completes

#### Scenario: Repeated polls do not snowball
- **WHEN** multiple browser tabs / reconnects poll the same heavy session's diff concurrently
- **THEN** the server SHALL NOT accumulate one git spawn per poll per file
- **AND** HTTP request handling SHALL NOT stall into an unrecoverable spawn storm

#### Scenario: Large transcript does not block the event loop
- **WHEN** a session's transcript on disk is tens of megabytes
- **AND** `GET /api/session-diff` is parsing it
- **THEN** a concurrent `GET /api/health` SHALL respond within a small latency budget (e.g. < 100 ms)

### Requirement: Session-diff result cache and single-flight

The server SHALL cache session-diff results per session for a short TTL, keyed by a signature that changes when the diff would change (HEAD sha + dirty-file signature + event-source signature: transcript size/mtime when the session is eligible for transcript sourcing, else the count of Write/Edit/Bash tool-call start events in the in-memory stream). Concurrent requests for the same key SHALL coalesce onto one in-flight computation (single-flight) rather than each launching its own diff. A cache hit SHALL NOT read or parse the transcript.

#### Scenario: Cache hit within TTL avoids recompute
- **WHEN** two `GET /api/session-diff` requests for the same session arrive within the cache TTL
- **AND** the session's HEAD, dirty state and transcript are unchanged between them
- **THEN** the second request SHALL return the cached result without recomputing the diff

#### Scenario: Concurrent identical requests coalesce
- **WHEN** two identical session-diff requests are in flight simultaneously for the same key
- **THEN** the server SHALL compute the diff once and serve both from that single computation

#### Scenario: State change busts the cache
- **WHEN** the session's HEAD sha or dirty-file signature changes
- **THEN** the next request SHALL recompute the diff rather than serve a stale cached entry

#### Scenario: New tool call on an already-dirty file busts the cache
- **WHEN** the session records a new Write/Edit call against a file that was already dirty (so the dirty-file signature does not change)
- **THEN** the next request SHALL recompute the diff and include the new change event

#### Scenario: Cache hit does not touch the transcript
- **WHEN** a second `GET /api/session-diff` for the same key arrives within the TTL
- **THEN** the server SHALL NOT read or parse the transcript for that request

#### Scenario: Store-sourced session invalidates on a new tool call
- **WHEN** a session is served from the in-memory event stream and records a new Write/Edit/Bash tool-call start event
- **THEN** the next request SHALL recompute rather than serve the cached result

#### Scenario: Streaming text alone does not bust the cache
- **WHEN** a session is streaming an assistant response with no new tool call, and HEAD and dirty state are unchanged
- **THEN** a second request within the TTL SHALL be served from the cache
