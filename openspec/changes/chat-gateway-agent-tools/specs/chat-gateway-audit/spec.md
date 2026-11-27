## MODIFIED Requirements

### Requirement: Append-only command log
Every action-bearing request reaching the layer SHALL produce exactly one log entry, whether it was permitted or refused, except that commands refused by the per-user command rate limit of `chat-gateway-query-mode` SHALL produce one entry per burst of refusals, not one per command. Entries SHALL be append-only: the layer SHALL provide no interface to edit or delete them. An entry for a guild request SHALL record the server id. A message dropped because its server is not enabled SHALL NOT produce an entry. A request made by a pi agent tool SHALL be logged with principal `session:<sessionId>`, verb `agent_send` (or `agent_read` in the opt-in read ring), an empty channel id when it has no channel, and a refusal reason of the form `discord_error:<code>` for a Discord API failure. A human denial of an agent-tool confirmation SHALL be logged as refused with reason `user_denied`.

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

#### Scenario: Rate-limited burst is one entry
- **WHEN** a user's 40 commands in one burst are refused `command_rate_limited`
- **THEN** one entry with that reason and the server id is appended for the burst, and the earlier entries are untouched

#### Scenario: Agent request is logged without a channel
- **WHEN** a pi agent tool request that has no channel is logged
- **THEN** the entry has principal `session:<sessionId>`, an empty channel id, and survives a reload of the log

#### Scenario: Denied agent-tool confirmation is logged
- **WHEN** the user denies the confirmation of a previewed agent send
- **THEN** the log holds one entry with verb `agent_send`, outcome `refused` and reason `user_denied`, and no message text

### Requirement: Log entries identify by stable identifier
Log entries and provenance tags SHALL record Discord identifiers that do not change when a user alters their display name or server nickname. An entry made by a pi agent tool SHALL instead identify its principal by the host's stable session id, `session:<sessionId>`, and SHALL list the channel ids of the session's gateway bindings when it has any, so the entry stays attributable to a Discord channel.

#### Scenario: User renames themselves
- **WHEN** a principal changes their nickname after issuing commands
- **THEN** their earlier entries still resolve to the same identity

#### Scenario: Agent entry names its session and bound channels
- **WHEN** a session attached in channel C proposes a send and an entry is written
- **THEN** the entry's principal is `session:<sessionId>` and it lists channel C

#### Scenario: Unbound session lists no channel
- **WHEN** a session with no gateway binding calls an agent tool and an entry is written
- **THEN** the entry has principal `session:<sessionId>` and lists no bound channel

### Requirement: Log survives restarts and does not grow without bound
The command log SHALL persist across dashboard restarts and SHALL be bounded by an operator-configurable retention limit expressed in entries, defaulting to 10,000, where `0` means unlimited. When the limit is reached, the oldest entries SHALL be discarded first and newer entries SHALL continue to be recorded.

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

#### Scenario: Unlimited retention
- **WHEN** the retention limit is `0` and the log holds more entries than the default limit
- **THEN** no entry is discarded
