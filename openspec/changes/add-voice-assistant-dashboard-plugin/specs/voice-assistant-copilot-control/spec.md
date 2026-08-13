## ADDED Requirements

### Requirement: Start/stop meeting copilot from the dashboard
The system SHALL provide a `session-card-action-bar` control that starts meeting-copilot capture (mic + system audio via `runCapture({})`) plus a per-capture batch consumer that awaits the vendored `runPoll(cfg, windowSeconds)` for that capture only (design 4f), and a control that stops both, for a session — with no `.claude/skills`, no `set-copilot` CLI, and no Claude Code involvement. Meeting-copilot capture SHALL always use the dashboard server's own local audio devices; the browser-mic capture source available to dictation SHALL NOT apply here, because a browser tab cannot capture the other party's audio in a call.

#### Scenario: Capture source is not selectable for meeting copilot
- **WHEN** the user opens the meeting-copilot control
- **THEN** no capture-source picker is offered, and capture uses the dashboard server's own microphone and system audio

#### Scenario: User starts the meeting copilot
- **WHEN** the user clicks "Start meeting copilot" on a session card for a project with `knowledge.sources` configured
- **THEN** the server starts capture and that capture's own batch consumer, and begins forwarding reaction-worthy transcript batches to the target session

#### Scenario: User stops the meeting copilot
- **WHEN** the user clicks "Stop meeting copilot" while it is running
- **THEN** the server stops capture, stops that capture's batch consumer, and unsubscribes its `ctx.onEvent` handler for that session

### Requirement: Transcript batches are forwarded to the target session via sendToSession
The system SHALL forward each reaction-worthy poll batch (lines carrying `topics`, `urgency`, `question`, or `command`, per the vendored `TranscriptWriter`'s own annotations) to the target pi session using `ctx.sendToSession(targetSessionId, message)`. The first batch of a meeting-copilot run SHALL additionally include the rendered policy (`renderCopilotPrompt(cfg)`) as framing context.

#### Scenario: First batch includes policy framing
- **WHEN** the first reaction-worthy batch after start is forwarded
- **THEN** the message sent via `sendToSession` includes the rendered alert-category/engagement policy ahead of the batch's transcript lines

#### Scenario: Subsequent batches are transcript-only
- **WHEN** a later reaction-worthy batch is forwarded during the same meeting-copilot run
- **THEN** the message contains only that batch's transcript/event lines, without repeating the policy framing

### Requirement: Content forwarded to the target session is full-fidelity, not redacted
The system SHALL forward transcript batches to the target session via `sendToSession` WITHOUT applying the wall's redaction rules (`wall/redaction.ts`). Redaction is scoped exclusively to what reaches a wall client (per `voice-assistant-meeting-wall`'s Redaction requirement); the reasoning session always receives the full, unredacted transcript, since redaction would degrade its ability to reason correctly about what was actually said.

#### Scenario: A line matching a redaction rule still reaches the session unredacted
- **WHEN** a transcript line matches a configured redaction rule AND that line is part of a reaction-worthy batch
- **THEN** the message delivered to the target session via `sendToSession` contains the line's original, unredacted text
- **AND** only the copy of that content later mirrored onto the wall (via `ingest()`, per `voice-assistant-meeting-wall`) is redacted

### Requirement: Meeting copilot status badge
The system SHALL show a `session-card-badge` reflecting meeting copilot state (idle, listening, error) for a session.

#### Scenario: Badge reflects active copilot session
- **WHEN** the meeting copilot is running for a session
- **THEN** the session card shows a "listening" badge state until it is stopped or errors

### Requirement: Missing knowledge configuration is surfaced
The system SHALL detect when NEITHER knowledge backend can serve a project — no indexed kb for the folder AND no `knowledge.sources` configured in `set-copilot.config.json` — and reflect that as a distinct state before starting capture. An indexed kb alone SHALL be sufficient; configured `knowledge.sources` alone SHALL also be sufficient.

#### Scenario: Neither backend available
- **WHEN** the user opens the meeting copilot control for a project with no indexed kb and an empty or missing `knowledge.sources`
- **THEN** the action bar shows a "knowledge required" state instead of a working start button, offering both remedies (index the folder with kb, or configure `knowledge.sources`)

#### Scenario: kb alone is sufficient
- **WHEN** the project has an indexed kb but no `knowledge.sources` configured
- **THEN** the meeting copilot control is available, using the kb backend

#### Scenario: Configured sources alone are sufficient
- **WHEN** the project has `knowledge.sources` configured but no indexed kb
- **THEN** the meeting copilot control is available, using the vendored fallback backend

### Requirement: Delivery failure does not silently drop a batch
The system SHALL detect when `ctx.sendToSession` returns `false` for a forwarded batch and surface a copilot error state rather than continuing to poll into a disconnected target.

#### Scenario: Target session disconnects mid-meeting
- **WHEN** `sendToSession` returns `false` while forwarding a batch
- **THEN** the badge switches to an error state and the batch consumer stops forwarding further batches to that session until the user restarts the copilot against a connected target

### Requirement: Recorded parties are surfaced to the operator at start
Meeting copilot captures system audio — the other party's speech — and transcribes it. The system SHALL make that explicit to the operator at the moment capture starts, so the choice to inform participants is deliberate rather than buried in documentation.

#### Scenario: Start makes the capture scope explicit
- **WHEN** the user starts meeting copilot
- **THEN** the confirmation makes clear that BOTH the local microphone and system audio (the other party) are captured and transcribed, and where the transcript is sent

#### Scenario: Awareness is not a silent default
- **WHEN** meeting copilot is running
- **THEN** an active-capture indicator remains visible for the duration, rather than the capture being discoverable only from the original click

### Requirement: Forwarded transcript text persists in the target session's history
Because forwarding is full-fidelity (see the redaction requirement above) and pi sessions persist their transcripts to disk, unredacted meeting content is written to the target session's own on-disk history. The system SHALL make this consequence explicit rather than implicit.

#### Scenario: On-disk persistence is disclosed
- **WHEN** the user starts meeting copilot for a target session
- **THEN** the interface discloses that forwarded transcript content becomes part of that session's persistent history, and is not removed when the meeting ends

### Requirement: Batch forwarding applies backpressure
`sendToSession` returns immediately and does not wait for the target session to finish reasoning. The system SHALL therefore keep at most one batch in flight per `{ projectRoot, targetSessionId }` pair, and SHALL coalesce batches produced while the session is mid-turn rather than queueing them without bound.

#### Scenario: A batch arriving mid-turn does not stack
- **WHEN** a new reaction-worthy batch is produced while the previous batch is still being processed by the target session
- **THEN** it is coalesced with any other pending content rather than dispatched as an additional concurrent message

#### Scenario: Overflow drops oldest and marks the truncation
- **WHEN** pending coalesced content exceeds the configured cap
- **THEN** the oldest lines are dropped, an explicit truncation marker appears in the dispatched payload, and the wall still receives every line

#### Scenario: A long meeting cannot front-run the model
- **WHEN** batches are produced faster than the target session drains them for a sustained period
- **THEN** pending content is bounded, and the user is not flooded with a backlog of queued prompts when the session becomes free

### Requirement: Capture is torn down on abnormal termination, not only on explicit stop
The system SHALL tear down capture — child processes, the STT connection, the wall server, and its live-server registration — when the target session ends, and SHALL ensure spawned recorder processes cannot outlive the dashboard server process.

#### Scenario: Target session ends while copilot is running
- **WHEN** the target session ends without the user clicking stop
- **THEN** capture for that pair is stopped and its state removed, via the `onSessionEnded` hook

#### Scenario: Dashboard server is killed
- **WHEN** the dashboard server process is killed or restarted while capture is active
- **THEN** spawned audio-capture child processes terminate with it rather than being orphaned holding the microphone

#### Scenario: Live-server registration does not leak
- **WHEN** capture stops for any reason
- **THEN** the wall's live-server registration is removed, so no stale target persists in the user's saved-targets list or in `preferences.json`

### Requirement: Concurrent capture of the same device is refused
Dictation and meeting copilot both capture the same operating-system microphone, and the host has ONE such device while the architecture permits many concurrent capture pairs. The system SHALL therefore refuse a start that would contend for a capture device already held by ANY active capture on the host — including one belonging to a different project — naming the current holder, and SHALL treat a repeated start for an already-running pair as idempotent.

#### Scenario: Copilot start while dictation holds the mic
- **WHEN** the user starts meeting copilot for a project where dictation is currently capturing
- **THEN** the start is refused with an explicit reason rather than launching a second recorder

#### Scenario: Contention across projects is also refused
- **WHEN** the user starts a capture in one project while another project's capture already holds the device
- **THEN** the start is refused and names the holding project, because the contention is host-wide rather than per-project

#### Scenario: Duplicate start is idempotent
- **WHEN** the user starts meeting copilot for a pair where it is already running
- **THEN** no second capture or poll consumer is created

### Requirement: Failures in vendored code do not take down the dashboard
Vendored third-party modules run in-process in the server that hosts every session. The system SHALL confine a failure originating in vendored code to the affected capture pair.

#### Scenario: Vendored code throws during a batch
- **WHEN** vendored transcript, wall, or knowledge code raises an unhandled error while processing a batch
- **THEN** that capture pair enters an error state, and other capture pairs and the dashboard server continue running

#### Scenario: STT connection drops
- **WHEN** the speech-to-text connection drops, expires, or is rate-limited
- **THEN** the capture surfaces an explicit error state and reconnect is bounded at 5 attempts with exponential backoff capped at 30s before entering a terminal error state
