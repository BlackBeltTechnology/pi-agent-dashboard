## MODIFIED Requirements

### Requirement: Resume session (continue)
The dashboard SHALL support resuming a session by spawning a new pi instance with `pi --session <session-file-path>`. This continues the same JSONL file and reuses the same pi session ID.

A `continue` resume SHALL be refused when the target `sessionFile` is already
served by a live bridge, under **any** session id — not only when the resumed
session's own id is live. The refusal SHALL be a hard error naming the
already-live session; the server SHALL NOT silently reuse or focus the existing
session, and SHALL NOT spawn a second pi against that session file.

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

#### Scenario: Zombie owner does not block resume
- **WHEN** the target `sessionFile` is recorded against a session whose bridge
  is gone
- **THEN** the resume SHALL proceed, preserving the existing zombie-resume
  behaviour

#### Scenario: Fork is unaffected by the session-file guard
- **WHEN** the user forks a session whose `sessionFile` is served by a live
  bridge
- **THEN** the fork SHALL proceed, because it targets a new JSONL file and a new
  session id
