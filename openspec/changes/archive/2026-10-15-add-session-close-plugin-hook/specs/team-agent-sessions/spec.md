## MODIFIED Requirements

### Requirement: Idle ending

Each team session SHALL be spawned with a plugin-declared close policy whose idle threshold is the configured `idleMinutes` (default 30) and whose mode is `sleep`; with `idleMinutes` `0` no close policy SHALL be declared and the idle rule SHALL never end a team session. The team plugin SHALL NOT run its own idle timer; idle ending SHALL be decided by the core quiescence reaper, so a team session SHALL NOT be idle-ended while a browser is subscribed to it, while an `ask_user` is pending, while follow-up or steering messages are queued, while a tool or a child process is running, or while it is streaming. The team plugin SHALL register a closer that keeps a session while an ensure of its conversation is in flight. An explicit conversation restart SHALL still end the session immediately. The conversation's next open SHALL resume an idle-ended session. The close policy SHALL survive a server restart.

#### Scenario: Idle session sleeps
- **WHEN** a conversation's session has had no activity for 31 minutes with the default config, no browser is subscribed, and it is at rest with nothing pending
- **THEN** the next reaper sweep ends it and the conversation shows `sleeping`

#### Scenario: Not yet idle
- **WHEN** a reaper sweep runs 29 minutes after the session's last activity
- **THEN** the session is not ended

#### Scenario: Long turn not interrupted
- **WHEN** an agent run has been streaming for 45 minutes with the default config
- **THEN** the session is not ended

#### Scenario: Watched session not ended
- **WHEN** alice has the conversation open in the team app and the session has had no activity for 2 hours
- **THEN** the session is not ended

#### Scenario: Pending question not ended
- **WHEN** the session has had no activity for 2 hours, nobody is watching, and an `ask_user` is unanswered
- **THEN** the session is not ended

#### Scenario: Ensure in flight keeps the session
- **WHEN** the session is idle-reapable and an ensure for its conversation is in flight
- **THEN** the team closer returns `keep` and the session is not ended in that sweep

#### Scenario: Idle ending disabled
- **WHEN** `idleMinutes` is `0`
- **THEN** team sessions are spawned with no close policy and are never idle-ended

#### Scenario: Idle ending survives restart
- **WHEN** the server restarts while a team session is live
- **THEN** the restored session is still governed by its 30-minute idle close policy
