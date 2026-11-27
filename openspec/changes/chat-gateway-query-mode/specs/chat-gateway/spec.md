## MODIFIED Requirements

### Requirement: Reach dashboard sessions from chat
Sessions started in the dashboard SHALL be reachable from chat without the gateway starting
them. The whole-message commands below SHALL be recognised in a handled channel. The read and
admin commands of `chat-gateway-query-mode` match a closed grammar, are answered in `interactive`
and `query` servers alike, and are never delivered as prompts; text that does not match one is
handled as before. In an `interactive` server `!search` and `!ask` are recognised only where no binding resolves. Any other text, including steer-prefixed text, is a prompt:

- `!sessions` — authorized as verb `list_sessions` (observe), with the binding's tier when
  the channel has a binding; replies with a numbered list (at most `limits.listRows`, default
  25, `0` = unlimited) of live, non-hidden sessions whose cwd lies in the channel's bound
  workspace (else, with no binding, in the server's `query.workspaces` within `allowedRoots`), each with name,
  status, short id and its thread when attached.
- `!attach <number | id-prefix>` — authorized as the chat-local verb `attach_session`
  (observe) with the target's cwd for the scope check; opens a thread named after the
  session on the command message, persists a binding with `source: "attach"` keyed to the
  thread, subscribes the session and confirms in the thread. A session already attached
  SHALL get a pointer to its existing thread, not a second one. Run inside a thread, it
  SHALL be refused with a hint. Every prompt later sent into the thread SHALL still be
  authorized as `send_prompt`.

Attached sessions SHALL NOT be hidden or otherwise re-policied by the gateway.

When `mirrorDashboardSessions` is `true` (default `false`; team-controls mode), the gateway
SHALL attach every live, non-hidden, unbound session whose cwd lies in a bound workspace
into that workspace's channel — at gateway start and when a session is first seen on the
host's forwarded event stream — by posting a `Dashboard session: <name>` message and
opening the thread on it. Each session SHALL be considered at most once per gateway run,
and persisted bindings SHALL prevent a duplicate thread after a restart. A session
skipped only because its server is not enabled and `interactive` SHALL NOT count as
considered, and SHALL be reconsidered when that server becomes so.

In a guild, `!attach` and auto-mirroring SHALL apply only in servers that are enabled and
in `interactive` mode, as specified in `chat-gateway-guilds`. `!sessions` SHALL be answered
in both modes: in a channel with no binding, including every channel of an enabled `query`
server, it lists only sessions in that server's `query.workspaces`, as specified in
`chat-gateway-query-mode`.
A session's thread SHALL be shown or pointed to only when that thread is in the same server as the command. A session attached only in another server SHALL be listed as attachable there, and attaching it SHALL open a second thread in this server.

#### Scenario: List then attach by number
- **WHEN** a permitted user sends `!sessions` then `!attach 1` in the workspace channel root
- **THEN** the gateway SHALL list the workspace's live sessions and open a thread bound to the first one, without starting a session

#### Scenario: Attach outside the workspace is refused
- **WHEN** `!attach` names a session whose cwd is outside the channel's workspace
- **THEN** no thread or binding SHALL be created

#### Scenario: Thread messages drive the attached session
- **WHEN** a user sends a message inside an attached thread
- **THEN** it SHALL be delivered to that session via `send_prompt`

#### Scenario: Auto-mirror at start and on a new session
- **WHEN** `mirrorDashboardSessions` is on and the gateway starts, or a new eligible session emits its first event
- **THEN** each eligible session SHALL get exactly one thread in its workspace channel

#### Scenario: Hidden sessions are never mirrored
- **WHEN** a session is hidden (headless worker or plugin-hidden)
- **THEN** it SHALL be neither listed nor auto-mirrored

#### Scenario: Attached in another server
- **WHEN** a session is attached in a thread of server B and a user in server A runs `!sessions` and `!attach <number>` for it
- **THEN** server A's list shows it with no thread pointer, and the attach opens a second thread in server A with no mention of server B

#### Scenario: Session commands in a query server
- **WHEN** `!sessions` then `!attach 1` is sent in an opted-in channel of an enabled `query` server
- **THEN** `!sessions` SHALL list only sessions in that server's `query.workspaces`, no thread SHALL be opened, and `!attach` SHALL get `Refused: query_mode.`

#### Scenario: List row cap is a setting
- **WHEN** `limits.listRows` is `0` and 40 sessions are in scope
- **THEN** `!sessions` SHALL list all 40

#### Scenario: Read command in an interactive server is not a prompt
- **WHEN** a permitted principal sends the whole message `!status` in a bound channel of an `interactive` server
- **THEN** the gateway SHALL answer it in place and SHALL NOT deliver it to the bound session as a prompt

#### Scenario: Steer text that is not a command still steers
- **WHEN** a user sends `!status of the build is red, fix it` into an attached thread of an `interactive` server
- **THEN** the text SHALL NOT match a command grammar and SHALL be delivered to the session as a steer

### Requirement: Configuration surface
The gateway SHALL expose configuration for: the Discord bot token, `allowedRoots`, the
fixed channel→cwd map, the user allowlist and admins, `sessionVisibility`,
`threadPerConversation`, `mirrorDashboardSessions`, and a read view of current bindings.
Secrets SHALL be stored at rest with restrictive permissions consistent with existing
dashboard credential handling and SHALL NOT appear in logs or API responses.
The surface SHALL also list every configured or discovered server with its name, id,
enabled state, mode, admins, allowlist, channels, server tiers and provisioning. Admins
and channel opt-in SHALL be edited per server, and limits SHALL be editable with `0`
shown as unlimited. Each server's query commands, message index, index statistics, ask
outcomes and problems, and the gateway-wide `discordIntents.guildMembers` toggle, SHALL be
shown and edited on the same surface.

#### Scenario: Token is not leaked
- **WHEN** the gateway configuration is read back via any surface
- **THEN** the bot token SHALL NOT be returned in plaintext

#### Scenario: Server list shows discovered and configured servers
- **WHEN** the bot is in three servers and one has a record
- **THEN** settings list all three, two marked discovered and inert, each with its live name

#### Scenario: Server row shows index state
- **WHEN** an operator opens a server that has the index enabled
- **THEN** the row shows the indexed message count, size, oldest entry and any problems
