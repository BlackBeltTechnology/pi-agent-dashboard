## Purpose

Records who in Discord caused which dashboard action, so that a session's origin remains attributable long after the chat context is gone and a misuse of a shared credential can be traced to a person.

## ADDED Requirements

### Requirement: Sessions carry Discord provenance
A session created or first driven through the Discord bridge SHALL be tagged with the invoking principal's Discord identifier and the originating channel identifier, using the dashboard's existing session-tagging mechanism.

#### Scenario: Session driven from Discord
- **WHEN** a principal sends the first prompt to a session from Discord
- **THEN** the session carries tags identifying that principal and that channel
- **AND** the tags are visible on the session in the dashboard UI

#### Scenario: Session never touched from Discord
- **WHEN** a session is only ever driven from the dashboard
- **THEN** it carries no Discord provenance tags

### Requirement: Append-only command log
Every action-bearing request reaching the plugin SHALL produce exactly one log entry, whether it was permitted or refused. Entries SHALL be append-only: the plugin SHALL provide no interface to edit or delete them.

#### Scenario: Permitted prompt
- **WHEN** a `control` principal sends a prompt
- **THEN** an entry records the principal, the channel and thread, the resolved tier, the action, the target session, and the outcome

#### Scenario: Refused command
- **WHEN** a request is refused for insufficient tier, a disarmed plugin, a scope violation, or a non-delegable verb
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
The command log SHALL be viewable from the plugin's dashboard settings surface and SHALL NOT be readable through Discord.

#### Scenario: Operator reviews activity
- **WHEN** an operator opens the plugin's settings surface
- **THEN** recent command-log entries are listed most-recent-first

#### Scenario: Principal requests the log from Discord
- **WHEN** any principal asks the bot for the command log in a channel
- **THEN** the plugin refuses and directs them to the dashboard

### Requirement: Log survives restarts and does not grow without bound
The command log SHALL persist across dashboard restarts and SHALL be bounded by a retention policy that discards oldest entries first.

#### Scenario: Dashboard restarted
- **WHEN** the dashboard restarts
- **THEN** previously recorded entries remain readable

#### Scenario: Retention limit reached
- **WHEN** the log reaches its configured retention bound
- **THEN** the oldest entries are discarded and newer entries continue to be recorded
