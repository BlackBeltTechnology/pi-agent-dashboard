## MODIFIED Requirements

### Requirement: Append-only command log
Every action-bearing request reaching the layer SHALL produce exactly one log entry, whether it was permitted or refused, except that commands refused by the per-user command rate limit of `chat-gateway-query-mode` SHALL produce one entry per burst of refusals, not one per command, and that a moderation request instead follows `chat-gateway-moderation`, which writes an entry per refusal and per authorization and whose tier check writes none by itself. Entries SHALL be append-only: the layer SHALL provide no interface to edit or delete them. An entry for a guild request SHALL record the server id. A message dropped because its server is not enabled SHALL NOT produce an entry. A request made by a pi agent tool SHALL be logged with principal `session:<sessionId>`, verb `agent_send` (or `agent_read` in the opt-in read ring), an empty channel id when it has no channel, and a refusal reason of the form `discord_error:<code>` for a Discord API failure. A human denial of an agent-tool confirmation SHALL be logged as refused with reason `user_denied`; an agent moderation request SHALL be logged as `chat-gateway-moderation` specifies, with its own verb and reasons.

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

#### Scenario: Moderation request without an authorization
- **WHEN** a moderation request is accepted and its confirmation is never answered
- **THEN** the log holds a refusal entry for the expiry and no `permitted` entry

#### Scenario: Moderation tier check writes nothing by itself
- **WHEN** an admin with `operate` posts a `!mod ban` that passes the gate and the confirmation is never answered
- **THEN** the log holds no `permitted` entry and no chokepoint entry for it, and the invoker's later Yes adds exactly one `permitted` entry

#### Scenario: Agent moderation denial uses the moderation verb
- **WHEN** the user denies the confirmation of a previewed agent moderation request
- **THEN** the log holds one entry with the verb `mod_<action>`, outcome `refused` and reason `moderation_cancelled`, and none with verb `agent_send`
