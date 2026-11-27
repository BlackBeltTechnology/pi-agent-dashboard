## MODIFIED Requirements

### Requirement: Append-only command log
Every action-bearing request reaching the layer SHALL produce exactly one log entry, whether it was permitted or refused. Entries SHALL be append-only: the layer SHALL provide no interface to edit or delete them. An entry for a guild request SHALL record the server id. A message dropped because its server is not enabled SHALL NOT produce an entry.

#### Scenario: Permitted prompt
- **WHEN** a `control` principal sends a prompt
- **THEN** an entry records the principal, the channel and thread, the resolved tier, the action, the target session, and the outcome

#### Scenario: Refused command
- **WHEN** a request is refused for insufficient tier, a disarmed layer, a scope violation, or a non-delegable verb
- **THEN** an entry records the attempt and the specific reason for refusal

#### Scenario: Mirroring is not an action
- **WHEN** session activity is mirrored into a thread
- **THEN** no command-log entry is produced

#### Scenario: Entry names the server
- **WHEN** a request from an enabled server is permitted or refused
- **THEN** its entry carries that server's id
