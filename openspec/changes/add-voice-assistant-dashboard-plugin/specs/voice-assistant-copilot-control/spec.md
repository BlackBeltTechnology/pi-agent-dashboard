## ADDED Requirements

### Requirement: A meeting is a transcriber session plus a copilot session
From the folder row the system SHALL offer Start meeting, Dry run, and (while running) Stop, Open copilot and Open transcriber. The live wall's own folder entry and menu items come from the wall plugin; the copilot session header and the meeting toast SHALL link to the wall page `/folder/<encodedCwd>/wall` while a wall runs. Starting SHALL run: preflight → render policy → spawn the copilot session → priming and pre-read → spawn the meeting transcriber (mic + system audio, audio tee on) → ensure the wall → running. Meetings SHALL capture only the dashboard host's devices.

#### Scenario: Phased start
- **WHEN** the user confirms Start meeting
- **THEN** the copilot is spawned and primed before the transcriber starts capturing, and the badge shows each phase

#### Scenario: Pre-read timeout does not block
- **WHEN** the copilot has not confirmed pre-read within 120 seconds
- **THEN** the transcriber is started and the badge shows "pre-read unconfirmed"

#### Scenario: Dry run
- **WHEN** a dry-run meeting stops
- **THEN** nothing is archived, no notes are written, and kb is not reindexed

### Requirement: Stop sequence
Stopping SHALL send `/voice-stop` to the transcriber and wait for `archived` (or `error`), then send `/voice-meeting-ended` to the copilot (stop poll, notes turn), then end both sessions, stop the wall, and request a kb reindex.

#### Scenario: Normal stop
- **WHEN** the user stops a meeting
- **THEN** the archive exists, the notes turn ran, both sessions have ended, the wall is stopped, and one reindex was requested

#### Scenario: A session dies
- **WHEN** either meeting session ends unexpectedly
- **THEN** the meeting stops, whatever transcript exists is archived, and the badge shows an error

### Requirement: Batches reach the copilot through its own poll
The copilot extension SHALL run the vendored poll in a child process and deliver reaction-worthy batches into its own session with a follow-up user message only when the session is idle; spoken commands and name-addressed lines SHALL be delivered as steering immediately. The server SHALL NOT relay batches.

#### Scenario: Idle copilot
- **WHEN** a reaction-worthy batch arrives while the copilot is idle
- **THEN** it is delivered as one follow-up message

#### Scenario: Busy copilot
- **WHEN** a batch arrives mid-turn
- **THEN** it is merged into a pending payload and delivered on turn end

#### Scenario: Spoken command
- **WHEN** a `{"type":"command"}` line arrives mid-turn
- **THEN** it is delivered as steering without waiting for the turn to end

#### Scenario: Quiet batch
- **WHEN** a batch has no annotated line
- **THEN** nothing is delivered

### Requirement: Bounded pending payload
The pending payload SHALL be capped (default 200 lines OR 32 KB); on overflow the oldest lines SHALL be dropped and a truncation marker inserted.

#### Scenario: Overflow
- **WHEN** pending content exceeds the cap
- **THEN** the delivered message carries a truncation marker and the newest lines

### Requirement: Full-fidelity copilot input
Content delivered to the copilot SHALL NOT be wall-redacted.

#### Scenario: Redaction-matching line
- **WHEN** a line matches a wall redaction rule
- **THEN** the copilot receives it unredacted

### Requirement: Mirror off by default; wall input gated
The copilot's chat SHALL NOT appear on the wall unless mirroring was enabled at start (then only final, non-filler assistant text). `wall-input` lines SHALL be delivered only when the wall plugin allow-lists the project, prefixed `[wall operator]:`.

#### Scenario: Default
- **WHEN** a meeting runs without mirroring
- **THEN** only `wall_emit` events reach the wall

#### Scenario: Wall input not allowed
- **WHEN** a `wall-input` line arrives for a non-allow-listed project
- **THEN** it is dropped and logged

### Requirement: Knowledge required
The system SHALL show "knowledge required" when neither an indexed admissible kb nor `knowledge.sources` is available; either alone SHALL suffice.

#### Scenario: Neither
- **WHEN** a folder has neither
- **THEN** Start meeting is replaced by that state with both remedies

### Requirement: Disclosure at start
The start dialog SHALL state that mic and system audio (the other party) are captured, recorded to scratch audio for speaker naming (deleted after archive unless kept), transcribed, sent to a new copilot session whose history persists, and archived to the shown path and indexed (or not, for a dry run).

#### Scenario: Dialog content
- **WHEN** the user opens Start meeting
- **THEN** all of the above is shown with the resolved archive path

### Requirement: Owner gating
All meeting routes SHALL require that the requester owns or may access the folder's meeting.

#### Scenario: Other user
- **WHEN** another principal calls stop
- **THEN** it is rejected and the meeting continues
