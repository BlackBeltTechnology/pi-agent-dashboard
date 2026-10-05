## ADDED Requirements

### Requirement: Transcription runs in a separately spawned transcriber session
The system SHALL perform all audio capture and speech-to-text in a pi session spawned by the plugin for that purpose (the transcriber), never in the dashboard server process. The transcriber SHALL be spawned with no tools, a configured low-cost model, the transcriber extension, owner-stamped with the requesting principal, and correlated by a per-spawn nonce.

#### Scenario: Dashboard hosts no audio code
- **WHEN** the server entry's module graph is inspected
- **THEN** it imports no vendored capture, poll, handover, or stitch-run module and never calls vendored `loadConfig`

#### Scenario: Transcriber has no tool surface
- **WHEN** the transcriber session is spawned
- **THEN** its spawn scope disables tools, so the session cannot run commands or read files even if prompted

#### Scenario: Spawn timeout
- **WHEN** no session resolves with this spawn's nonce within 30 seconds
- **THEN** the spawn is aborted and the start fails cleanly with no capture running

### Requirement: The transcriber extension owns the capture child
On session start the transcriber extension SHALL spawn the vendored capture in a child process (own process group, `cwd` = project root, env allowlist, `SET_COPILOT_DIR`, STT key) and SHALL kill that process group on session shutdown.

#### Scenario: Vendored exit is contained
- **WHEN** the capture child exits with an error
- **THEN** the transcriber reports phase `error` with the child's stderr tail, and neither the pi process nor the dashboard exits

#### Scenario: Session ends during capture
- **WHEN** the transcriber session ends for any reason
- **THEN** the capture child's process group is terminated

### Requirement: Status is published through a file
Each voice extension SHALL write `status.json` in its runtime dir atomically (role, phase, detail, counters, timestamp), and the server SHALL derive badges from it by watching the file, without a polling timer.

#### Scenario: Phase change reaches the badge
- **WHEN** the transcriber moves from `starting` to `live`
- **THEN** the dictation or meeting badge shows `live`

### Requirement: Stop is a session command
The server SHALL stop a transcriber by sending `/voice-stop` through the dashboard's session command dispatch, and the extension SHALL finish its mode's hand-over (dictation) or archive (meeting) before reporting `done` or `archived`.

#### Scenario: Stop dictation
- **WHEN** the server sends `/voice-stop` to a dictation transcriber
- **THEN** capture stops, `handover.json` with `{text, raw}` is written, and the phase becomes `done`

### Requirement: STT key comes from our voice configuration
The server SHALL resolve the speech-to-text key through `video-transcription`'s configuration (the same source `pi-transcribe` uses), with an optional plugin credential override, SHALL pass it to the transcriber only through extension configuration, and SHALL NOT write it into project files.

#### Scenario: Shared key source
- **WHEN** `SONIOX_API_KEY` is configured for `pi-transcribe`
- **THEN** a transcriber started by the plugin uses the same key with no further setup

#### Scenario: Key never in project
- **WHEN** a transcription runs
- **THEN** no file under the project root contains the key

### Requirement: Runtime dirs and time limit
Runtime dirs SHALL be under `~/.pi/dashboard/voice/<hash(projectRoot)>/` (`dict-<sessionId>/`, `meeting-<meetingId>/`, new per meeting). Capture SHALL stop itself after `maxMinutes` (default 240) and follow the normal stop path.

#### Scenario: Limit reached
- **WHEN** a meeting reaches the limit
- **THEN** capture stops and the meeting is archived as on a user stop

### Requirement: Host-wide device guard
The server SHALL refuse to spawn a server-local transcriber while any other server-local capture is active on the host, naming the holder; a repeated start for the same dictation pair or folder meeting SHALL be idempotent; browser-source dictation SHALL be exempt.

#### Scenario: Contention
- **WHEN** project B starts a meeting while project A's server dictation is live
- **THEN** B is refused and the message names A

### Requirement: Orphans are reaped
On plugin activation the system SHALL terminate any live runtime-dir owner under the scratch root.

#### Scenario: After kill -9
- **WHEN** the dashboard or a transcriber pi process was killed with SIGKILL during capture and the plugin activates
- **THEN** the orphaned capture child is terminated and the microphone is released

### Requirement: Reconnects are visible
The transcriber SHALL surface upstream's reconnect attempts as phase `reconnecting (n)` and clear it when transcription resumes; a terminal STT error SHALL set phase `error`.

#### Scenario: Socket drop
- **WHEN** the STT socket drops and recovers
- **THEN** the badge shows `reconnecting (n)` and then `live`
