## MODIFIED Requirements

### Requirement: Discord platform adapter behind an extensible interface
The gateway SHALL ship a Discord adapter implementing a platform-agnostic adapter
interface with at least `connect`, `disconnect`, `sendMessage(channelId, text) -> messageId`,
`editMessage(channelId, messageId, text)`, `setTyping(channelId, isTyping)`,
`sendInteractive(channelId, prompt)`, and an `onMessage` inbound callback. The adapter
SHALL be the only platform-specific code; routing, binding, and auth SHALL be
platform-agnostic so additional adapters can be added without core rework.
One bot token and one connection SHALL serve every server the bot is a member of. The
adapter SHALL tag each inbound message and interaction with its server id and SHALL list
the servers it is a member of.

#### Scenario: Discord connects and receives
- **WHEN** a valid Discord bot token is configured and the gateway starts
- **THEN** the Discord adapter SHALL connect and invoke `onMessage` for inbound messages from allowed users

#### Scenario: Adapter carries no hub logic
- **WHEN** the Discord adapter is inspected
- **THEN** it SHALL contain no session spawning, no `pi --mode rpc` subprocess, and no standalone HTTP/WS server — the dashboard is the hub

#### Scenario: One connection serves several servers
- **WHEN** the bot is a member of two enabled servers
- **THEN** a single connection receives messages from both and each message carries its server id

### Requirement: Layered authorization
The gateway SHALL enforce: L1 — only allowlisted platform users (established via a pairing
code or explicit config) may drive any session; L2 — only an admin may create a channel→cwd
binding (binding grants code execution); L4 — direct messages are isolated per user, and
shared group channels are opt-in per configuration. A pairing code SHALL expire after
`limits.pairingTtlMinutes` (default 15, `0` = never) and SHALL lock out after
`limits.pairingMaxAttempts` failed attempts (default 10, `0` = no lockout). Unauthorized inbound messages SHALL be
ignored or answered with a pairing prompt, never delivered to a session.

In addition, every action-bearing request that passes L1 SHALL be resolved to a tier and
authorized per binding as specified in `chat-gateway-tier-authorization`. That tier layer
SHALL only be able to refuse: it SHALL NOT admit a principal L1 rejected, and SHALL NOT
permit a binding L2 refused.

For guild traffic, the L1 allowlist, the L2 admins, and the L4 opt-in SHALL be resolved from
the record of the message's own server as specified in `chat-gateway-guilds`. A message
from a server that is not configured and enabled SHALL be dropped before L1.

#### Scenario: Non-allowlisted user is refused
- **WHEN** a message arrives from a user not on the allowlist
- **THEN** the gateway SHALL NOT deliver it to any session

#### Scenario: Non-admin cannot bind
- **WHEN** a non-admin attempts to bind a channel to a cwd
- **THEN** the binding SHALL be refused

#### Scenario: Expired or exhausted pairing code is rejected
- **WHEN** a pairing code is used after its configured expiry (default 15 minutes), or after its configured number of failed attempts (default 10)
- **THEN** the pairing SHALL be refused and the code invalidated

#### Scenario: Allowlisted user with no tier mapping
- **WHEN** an L1-allowlisted user sends an action-bearing message in a bound channel where they hold no tier mapping
- **THEN** the request SHALL be refused by the tier layer and SHALL NOT reach the session

#### Scenario: Tier layer cannot widen L1
- **WHEN** a principal holds a tier mapping for a binding but is not on the L1 allowlist
- **THEN** the request SHALL be refused at L1 and the tier mapping SHALL NOT grant access

#### Scenario: Unconfigured server never reaches L1
- **WHEN** an allowlisted admin writes in a server the bot is in but the operator has not enabled
- **THEN** the message is dropped without a reply and without an audit entry

### Requirement: Configuration surface
The gateway SHALL expose configuration for: the Discord bot token, `allowedRoots`, the
fixed channel→cwd map, the user allowlist and admins, `sessionVisibility`,
`threadPerConversation`, `mirrorDashboardSessions`, and a read view of current bindings.
Secrets SHALL be stored at rest with restrictive permissions consistent with existing
dashboard credential handling and SHALL NOT appear in logs or API responses.
The surface SHALL also list every configured or discovered server with its name, id,
enabled state, mode, admins, allowlist, channels, server tiers and provisioning. Admins
and channel opt-in SHALL be edited per server, and limits SHALL be editable with `0`
shown as unlimited.

#### Scenario: Token is not leaked
- **WHEN** the gateway configuration is read back via any surface
- **THEN** the bot token SHALL NOT be returned in plaintext

#### Scenario: Server list shows discovered and configured servers
- **WHEN** the bot is in three servers and one has a record
- **THEN** settings list all three, two marked discovered and inert, each with its live name

### Requirement: Reach dashboard sessions from chat
Sessions started in the dashboard SHALL be reachable from chat without the gateway starting
them. Two whole-message commands SHALL be recognised in a bound channel (any other text,
including steer-prefixed text, is a prompt):

- `!sessions` — authorized as verb `list_sessions` (observe); replies with a numbered list
  (at most 25) of live, non-hidden sessions whose cwd lies in the channel's bound workspace
  (else `allowedRoots`), each with name, status, short id and its thread when attached.
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

In a guild, these commands and auto-mirroring SHALL apply only in servers that are enabled
and in `interactive` mode, as specified in `chat-gateway-guilds`. A session's thread SHALL be
shown or pointed to only when that thread is in the same server as the command. A session
attached only in another server SHALL be listed as attachable there, and attaching it SHALL
open a second thread in this server.

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
- **WHEN** `!sessions` or `!attach 1` is sent in an opted-in channel of an enabled `query` server
- **THEN** no list is shown, no thread is opened, and the reply is `Refused: query_mode.`

### Requirement: One thread per conversation
When `threadPerConversation` is enabled (default `true`; only an explicit `false`
disables), an authorized message posted in a bound channel's root SHALL make the gateway
open a platform thread on that message and bind a **new** session keyed to the thread
(`(platform, threadId, threadId)`, parent channel recorded); the reply and all follow-ups
SHALL stay in that thread. Thread creation SHALL happen only after authorization and the
team-controls check, and never for DMs, messages already in a thread, or `!disarm`
commands. The thread name SHALL be the message text (steer prefix stripped, whitespace
collapsed, at most 100 characters; `conversation` when empty). If the adapter cannot
create a thread, the gateway SHALL log a warning and continue the conversation in the
channel root so the message is not lost. Adapters without thread support SHALL keep
channel-root behaviour. Threads SHALL be opened only in servers that are enabled and in
`interactive` mode, as specified in `chat-gateway-guilds`.

#### Scenario: Root message opens a thread
- **WHEN** an authorized user posts in the root of a bound channel with `threadPerConversation` on
- **THEN** the gateway SHALL open a thread on that message, start a new session bound to the thread, and reply inside it

#### Scenario: Follow-up stays in the thread
- **WHEN** the user replies inside that thread
- **THEN** the message SHALL route to the thread's session without opening another thread

#### Scenario: Opt-out keeps channel-root routing
- **WHEN** `threadPerConversation` is `false`
- **THEN** root messages SHALL bind to the channel root as before

#### Scenario: Thread creation failure falls back
- **WHEN** opening the thread fails (e.g. missing Create Public Threads permission)
- **THEN** the gateway SHALL log a warning and handle the message in the channel root

#### Scenario: Refused message opens no thread
- **WHEN** a message is refused by authorization or arrives as a DM
- **THEN** no thread SHALL be created

#### Scenario: Root message in a query server opens no thread
- **WHEN** an allowlisted user posts in an opted-in channel root of an enabled `query` server
- **THEN** no thread is created and no session is started

### Requirement: Close a conversation from chat
A whole-message `!close` sent inside a bound thread SHALL be authorized as the chat-local
verb `close_session` (tier `control`) with the bound session as target. When permitted:

- a thread whose session the gateway started or resumed (`source` `spawn`/`resume`) SHALL
  have its live session ended through the host's `shutdownSession` hook — the same shutdown
  the dashboard's Shutdown control performs — before anything else changes; if the host
  refuses, nothing SHALL change and the author SHALL be told;
- a thread bound by attach (`source: "attach"`) SHALL only be detached; the session SHALL
  keep running;
- in both cases the binding SHALL be removed, the session SHALL stop streaming into chat
  unless another binding still needs it, the author SHALL get a confirmation, and the
  thread SHALL be archived when the adapter supports it.

`!close` in a channel root SHALL only reply with a hint, and in an unbound thread SHALL
reply that there is nothing to close. Text that merely starts with `!close` SHALL remain a
steer prompt. Deleting channels SHALL NOT be possible from chat. `!close` SHALL be handled only in
servers that are enabled and in `interactive` mode, as specified in `chat-gateway-guilds`.

#### Scenario: Close a gateway-started conversation
- **WHEN** a `control` user sends `!close` in a thread whose live session the gateway started
- **THEN** that session SHALL be shut down, the binding removed and the thread archived

#### Scenario: Close an attached thread
- **WHEN** a `control` user sends `!close` in a thread bound by attach
- **THEN** the binding SHALL be removed and the thread archived, and the session SHALL keep running

#### Scenario: Observe principal cannot close
- **WHEN** an `observe` user sends `!close` in a bound thread
- **THEN** the request SHALL be refused and nothing SHALL change

#### Scenario: Close in a query server
- **WHEN** a user sends `!close` in an opted-in channel of an enabled `query` server
- **THEN** nothing is closed and the reply is `Refused: query_mode.`
