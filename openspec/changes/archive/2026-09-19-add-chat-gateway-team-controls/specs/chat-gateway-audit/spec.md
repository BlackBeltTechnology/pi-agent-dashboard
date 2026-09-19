## Purpose

Records who in Discord caused which dashboard action, so that a session's origin remains attributable long after the chat context is gone and a misuse of a shared credential can be traced to a person.

## ADDED Requirements

### Requirement: Sessions carry Discord provenance
A session created or first driven from chat SHALL carry a persisted plugin-owned reference identifying the invoking principal, the originating channel, and the binding, attached through the host's plugin-reference mechanism for sessions. The reference SHALL NOT be written into the tag namespace a user curates, so that an audit record cannot be edited or deleted from the UI.

#### Scenario: Session driven from Discord
- **WHEN** a principal sends the first prompt to a session from Discord
- **THEN** the session carries a persisted reference naming that principal, channel, and binding
- **AND** the provenance survives a dashboard restart

#### Scenario: Session never touched from Discord
- **WHEN** a session is only ever driven from the dashboard
- **THEN** it carries no Discord provenance tags

### Requirement: Append-only command log
Every action-bearing request reaching the layer SHALL produce exactly one log entry, whether it was permitted or refused. Entries SHALL be append-only: the layer SHALL provide no interface to edit or delete them.

#### Scenario: Permitted prompt
- **WHEN** a `control` principal sends a prompt
- **THEN** an entry records the principal, the channel and thread, the resolved tier, the action, the target session, and the outcome

#### Scenario: Refused command
- **WHEN** a request is refused for insufficient tier, a disarmed layer, a scope violation, or a non-delegable verb
- **THEN** an entry records the attempt and the specific reason for refusal

#### Scenario: Mirroring is not an action
- **WHEN** session activity is mirrored into a thread
- **THEN** no command-log entry is produced

### Requirement: Log entries identify by stable identifier
Log entries and provenance tags SHALL record Discord identifiers that do not change when a user alters their display name or server nickname.

#### Scenario: User renames themselves
- **WHEN** a principal changes their nickname after issuing commands
- **THEN** their earlier entries still resolve to the same identity

### Requirement: Log is readable from the dashboard
The command log SHALL be viewable from the dashboard configuration surface and SHALL NOT be readable through Discord.

#### Scenario: Operator reviews activity
- **WHEN** an operator opens the dashboard configuration surface
- **THEN** recent command-log entries are listed most-recent-first

#### Scenario: Principal requests the log from Discord
- **WHEN** any principal asks the bot for the command log in a channel
- **THEN** the layer refuses and directs them to the dashboard

### Requirement: Log survives restarts and does not grow without bound
The command log SHALL persist across dashboard restarts and SHALL be bounded by an operator-configurable retention limit expressed in entries, defaulting to 10,000. When the limit is reached, the oldest entries SHALL be discarded first and newer entries SHALL continue to be recorded.

#### Scenario: Dashboard restarted
- **WHEN** the dashboard restarts
- **THEN** previously recorded entries remain readable

#### Scenario: Retention limit reached
- **WHEN** one entry is recorded beyond the configured retention limit
- **THEN** the oldest entry is no longer present, the entry count equals the limit, and the newest entry is present

#### Scenario: Just below the retention limit
- **WHEN** the log holds exactly one entry fewer than the limit
- **THEN** no entry has been discarded

#### Scenario: Default limit on a fresh install
- **WHEN** no retention limit is configured
- **THEN** the effective limit is 10,000 entries
