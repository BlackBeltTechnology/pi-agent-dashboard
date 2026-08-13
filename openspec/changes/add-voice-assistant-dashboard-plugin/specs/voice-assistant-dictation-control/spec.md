## ADDED Requirements

### Requirement: Start/stop dictation capture from the dashboard
The system SHALL provide a `session-card-action-bar` action named `dict-start` (renames upstream's `ds`) that starts mic-only capture scoped to `{ projectRoot, targetSessionId }`, and an action named `dict-end` (renames upstream's `dd`) that stops it, for a given session — with no `.claude/skills`, no `set-copilot` CLI invocation, and no Claude Code involvement. `dict-start` SHALL accept a capture source of `server` (default, via the vendored `runCapture({ micOnly: true })`) or `browser` (per Requirement "Browser-mic capture source").

#### Scenario: User starts dictation
- **WHEN** the user triggers `dict-start` on a session card
- **THEN** the server starts mic-only capture scoped to that session's project and session id, and the action bar switches to a `dict-end` control

#### Scenario: User stops dictation
- **WHEN** the user triggers `dict-end` while capture is active
- **THEN** the server archives the transcript exactly once (vendored `handoverTranscriptOnce`), stitches it into plain text (vendored `stitchTranscript`/`stitchText`), and calls `ctx.sendToSession(targetSessionId, text)` so the text arrives in that pi session as a user message

#### Scenario: Stitching fails — fail open
- **WHEN** stitching the captured transcript throws or yields no text from a non-empty capture
- **THEN** the server sends the raw transcript text via `sendToSession` instead of discarding the captured speech

### Requirement: Dictation status badge
The system SHALL show a `session-card-badge` reflecting current dictation state (idle, recording, error) for a session.

#### Scenario: Badge reflects active recording
- **WHEN** dictation capture is running for a session
- **THEN** the session card shows a "recording" badge state until dictation stops or errors

### Requirement: Delivery failure is surfaced, text is not lost
The system SHALL detect when `sendToSession` returns `false` (no bridge connection for the target session) and surface an error state instead of discarding the stitched text.

#### Scenario: Target session has no bridge connection
- **WHEN** dictation stops and `ctx.sendToSession` returns `false` for the target session
- **THEN** the action bar shows a delivery-failed state and the stitched text remains available for a retry

### Requirement: Missing audio/STT preflight is surfaced
The system SHALL run a server-side preflight (STT backend configured, audio capture tooling present on the dashboard server's host) before starting capture, and reflect a failed preflight as a distinct badge/action-bar state.

#### Scenario: STT backend not configured
- **WHEN** the user opens dictation controls for a project with no Soniox key and no local whisper model configured
- **THEN** the action bar shows a "speech-to-text not configured" state instead of a working start button

#### Scenario: Capture location is legible to a remote user
- **WHEN** the user opens dictation controls from a browser connected to the dashboard remotely (tunnel or paired device)
- **THEN** the control surfaces which machine's microphone will be captured for the `server` source (the dashboard server's host, not the browser's), so a remote user is not misled into thinking their own local microphone will be used by that source

### Requirement: Browser-mic capture source
The system SHALL support a `browser` dictation capture source that captures audio via the browser's own `getUserMedia` and streams it to the server over a companion loopback WebSocket endpoint reverse-proxied through the dashboard's existing `"live"` WS-upgrade scope (`/live/:id/audio-ingest`), feeding the vendored Soniox client (`soniox-rt.ts`) exactly as the `server` source's `sox`/`parec` path does. The `browser` source SHALL be opt-in (not automatically selected) and SHALL leave server-local dictation and meeting-copilot capture entirely unaffected.

#### Scenario: User selects browser-mic dictation
- **WHEN** the user chooses the `browser` capture source and triggers `dict-start`
- **THEN** the browser requests microphone permission, and on grant streams audio to the companion WS endpoint, which the server feeds into the same stitching/handover/`sendToSession` pipeline the `server` source uses

#### Scenario: Companion WS endpoint requires no new core dashboard channel
- **WHEN** the browser connects to `/live/:id/audio-ingest` for a registered audio-ingest loopback target
- **THEN** the connection is tunneled via the existing `"live"` upgrade scope's raw pipe (`handleLiveServerUpgrade`), with no new `scope` case added to the dashboard's core WS upgrade dispatch

#### Scenario: Insecure context hides the browser-mic option, does not silently fail it
- **WHEN** the dashboard is reached over a non-secure context (plain `http://` on a non-`localhost` host, `window.isSecureContext` false)
- **THEN** the `browser` capture source is not offered as a choice (only `server` is available), rather than being offered and failing silently or with an unclear browser error

#### Scenario: Microphone permission denied
- **WHEN** the user selects the `browser` source and denies the microphone permission prompt
- **THEN** the action bar shows a distinct "microphone permission denied" state, not a generic error, and offers to retry

#### Scenario: No input device available
- **WHEN** the user selects the `browser` source on a device with no available audio input
- **THEN** the action bar shows a distinct "no microphone available" state

#### Scenario: Companion WS endpoint lifecycle mirrors capture lifecycle
- **WHEN** `dict-end` is triggered (or capture errors) for a `browser`-source dictation session
- **THEN** the companion loopback WS endpoint for that session is torn down AND its live-server registration is removed, not left resident (the happy path must not leak a stale saved-target row any more than the abnormal path)

### Requirement: Dictation capture is torn down on abnormal termination
The system SHALL stop dictation capture — child process, STT connection, and any browser-mic ingest listener with its live-server registration — when the target session ends or the dashboard server exits, not only when the user clicks stop.

#### Scenario: Target session ends mid-dictation
- **WHEN** the target session ends while dictation is recording
- **THEN** capture stops via the `onSessionEnded` hook, state for the pair is removed, and any captured text is retained for retrieval rather than silently discarded

#### Scenario: Server exits mid-dictation
- **WHEN** the dashboard server is killed or restarted while dictation is recording
- **THEN** the spawned recorder process terminates with it rather than being orphaned holding the microphone

#### Scenario: Ingest listener does not outlive the capture
- **WHEN** browser-mic dictation ends for any reason, including a dropped browser connection
- **THEN** the companion ingest listener is closed and its live-server registration removed

### Requirement: Ingest validates the audio format against the server-local path
The companion ingest endpoint SHALL validate that incoming audio matches the same sample format the server-local `sox`/`parec` path feeds the vendored STT client, rather than trusting the client. The exact format is whatever the vendored client requires and is fixed during implementation.

#### Scenario: Ingest accepts the matching format
- **WHEN** the browser streams audio in the same format the server-local capture path produces
- **THEN** the ingest endpoint accepts it and transcription proceeds identically to server-local capture

#### Scenario: Ingest rejects a format mismatch
- **WHEN** the browser streams audio whose sample format does not match that contract
- **THEN** the ingest endpoint rejects the stream with an explicit error surfaced to the user, rather than forwarding malformed audio to the STT client
