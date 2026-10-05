## ADDED Requirements

### Requirement: Dictation through a short-lived transcriber session, triggered from the composer
The system SHALL provide a mic control through the core `composer-toolbar-action` slot. Starting it SHALL spawn a dictation transcriber session for `{ projectRoot, targetSessionId }` (the composer's session) with source `server` (default) or `browser`; stopping it SHALL stop the transcriber, take the stitched text from its hand-over, deliver it per the delivery setting, and end the transcriber. No `.claude/skills`, no `set-copilot` CLI, no Claude Code.

#### Scenario: Dictate into the draft
- **WHEN** the user starts the mic, speaks, then stops it, with delivery `draft`
- **THEN** the stitched text is inserted into the composer at the caret via `insertAtCursor`, nothing is sent, and the transcriber session has ended

#### Scenario: Stitching fails — fail open
- **WHEN** the hand-over reports an empty stitch for a non-empty capture
- **THEN** the raw transcript text is delivered instead

#### Scenario: Silence only
- **WHEN** nothing was said
- **THEN** the draft is unchanged, nothing is sent, and the transcriber ends

#### Scenario: Upstream hook commands never run
- **WHEN** the project config defines hand-over hook commands
- **THEN** they are not executed

### Requirement: Delivery mode is a setting — draft by default
The global plugin config SHALL provide `dictation.delivery: "draft" | "send"` (default `draft`). With `send`, the text SHALL be inserted and then submitted through `composer.submit()` (honouring `Steer | Queue`) only when it has at least `dictation.minSendWords` words (default 3, counting words for languages written without spaces); shorter text SHALL be inserted but not sent.

#### Scenario: Send mode submits
- **WHEN** delivery is `send` and the transcript is "run the failing tests again"
- **THEN** the text is inserted and submitted as if the user pressed send

#### Scenario: Short transcript is not sent
- **WHEN** delivery is `send` and the transcript is "okay"
- **THEN** the text is inserted into the draft and not submitted

#### Scenario: Agent running with send mode
- **WHEN** delivery is `send`, the session is streaming, and the delivery control is `Queue`
- **THEN** the dictated prompt is queued, not steered

### Requirement: Activation modes and shortcut
The global plugin config SHALL provide `dictation.mode: "toggle" | "hold" | "auto"` (default `toggle`) and `dictation.shortcut` (default `Ctrl+M`, rebindable), active while the composer is focused. `toggle`: click/press starts, again stops. `hold`: recording runs while the button or shortcut is held. `auto`: a press shorter than 500 ms toggles, a longer hold is push-to-talk. The mic button always behaves as a toggle on click. Releasing a hold before the transcriber is `live` SHALL cancel the dictation.

#### Scenario: Toggle by shortcut
- **WHEN** mode is `toggle` and the user presses `Ctrl+M` twice in the focused composer
- **THEN** dictation starts on the first press and stops and delivers on the second

#### Scenario: Hold released before live
- **WHEN** mode is `hold` and the user releases the shortcut while the badge still reads `starting mic`
- **THEN** the dictation is cancelled and the draft is unchanged

### Requirement: Cancel restores the draft
`Esc` while recording or processing, or the control's cancel affordance, SHALL stop the transcriber, discard the transcript, and `restore()` the draft snapshot taken at start. `Esc` SHALL NOT also abort the agent turn.

#### Scenario: Esc cancels
- **WHEN** the user presses `Esc` while recording
- **THEN** the transcriber ends, no text is inserted, the draft equals its state before recording, and the running agent turn is not aborted

### Requirement: Mic stays available
The mic control SHALL remain visible and usable when the draft has text, attachments are present, or the agent is working, and a later dictation SHALL insert at the caret, so an interrupted dictation can be continued by speaking again.

#### Scenario: Continue after a stop
- **WHEN** a first dictation inserted text and the user starts the mic again
- **THEN** the second transcript is inserted at the caret after the first

### Requirement: Mic-live state is explicit
The mic control SHALL show `starting mic` from start until the transcriber reports `live`, then `recording` (with a level indicator when the browser source is used), then `processing` until hand-over completes. It SHALL NOT show `recording` before the transcriber is `live`. A start that does not reach `live` within the spawn timeout SHALL show a retryable error naming the failed stage.

#### Scenario: Spawn latency visible
- **WHEN** the transcriber session is still starting
- **THEN** the control reads `starting mic`, not `recording`

#### Scenario: Start times out
- **WHEN** the transcriber does not report `live` within the timeout
- **THEN** the control shows an error naming the stage, offers Retry, and the transcriber is ended

### Requirement: Text is never lost
If the composer that started dictation has unmounted, switched session, or its handle is inert when the text arrives, the server SHALL retain the text keyed by target session and `runId`; the next composer mounted for that session SHALL offer it (Insert / Copy / Discard). With delivery `send`, the server SHALL instead deliver via `sendToSession`; `false` SHALL be treated as delivery-failed and the text retained the same way.

#### Scenario: Composer closed mid-dictation
- **WHEN** the user navigates away before hand-over completes, with delivery `draft`
- **THEN** reopening that session's composer shows the retained text with Insert / Copy / Discard

#### Scenario: Send fallback fails
- **WHEN** delivery is `send`, the composer is gone, and `sendToSession` returns `false`
- **THEN** the text is retained and offered as above

### Requirement: Preflight
The system SHALL check, before spawning, that config is present and current-version, an STT key resolves, the resolved transcriber model is available, and (server source) capture tooling exists on the dashboard host, and SHALL show which machine's microphone the server source uses.

#### Scenario: No STT key
- **WHEN** no key resolves
- **THEN** the mic control is `aria-disabled` with the reason "speech-to-text not configured" and a link to settings

#### Scenario: Remote user sees the capture host
- **WHEN** the dashboard is used remotely
- **THEN** the mic control's source menu names the dashboard host as the server microphone location

### Requirement: Browser-mic source
The `browser` source SHALL capture with `getUserMedia` + `AudioWorklet` (raw PCM in the format the vendored STT client expects) and stream to a loopback ingest endpoint inside the transcriber's capture child, reached at `/live/<id>/audio-ingest` over the existing `"live"` WS scope. Plugin-owned WS routes SHALL NOT be used. The option SHALL be hidden in a non-secure context. The source is chosen from a menu on the mic control and remembered per browser.

#### Scenario: Remote dictation
- **WHEN** a user on a phone over the tunnel selects `browser` and dictates
- **THEN** their phone's audio is transcribed and inserted into the composer draft

#### Scenario: Insecure context
- **WHEN** `window.isSecureContext` is false
- **THEN** only the server source is offered

#### Scenario: Permission denied or no device
- **WHEN** permission is denied or no input exists
- **THEN** a distinct state is shown

#### Scenario: Format mismatch
- **WHEN** frames do not match the expected format
- **THEN** ingest rejects them with an explicit error

#### Scenario: Ingest lifecycle
- **WHEN** the transcriber ends for any reason
- **THEN** its ingest live-server registration is removed

### Requirement: Dictation is owner-gated and torn down with its target
Start/stop SHALL require access to the target session; if the target session ends during dictation, the transcriber SHALL be stopped and the text retained.

#### Scenario: Other user
- **WHEN** a principal without access triggers dictation start
- **THEN** it is rejected

#### Scenario: Target ends
- **WHEN** the target session ends mid-dictation
- **THEN** the transcriber stops and the captured text is retained
