## MODIFIED Requirements

### Requirement: Interactive prompts rendered natively via PromptBus
The gateway SHALL render a bound session's `prompt_request` (from pi `ask_user` or any
`ctx.ui` dialog method) as native Discord interactive UI and return the user's choice as
`prompt_response`. `select`, `confirm`, `input`, and `editor` SHALL be
supported; `multiselect` and `batch` SHALL be supported via a composition of native
controls. The gateway SHALL acknowledge each Discord interaction within Discord's ~3s
window by **deferring immediately** (deferred update) and then editing the deferred reply
when the session responds. On `prompt_dismiss`/`prompt_cancel` for that prompt, the gateway
SHALL remove or disable the interactive controls.

The gateway SHALL NOT render an agent-tool confirmation, that is a `prompt_request` whose
`metadata.plugin` has `pluginId: "chat-gateway"` and `kind: "agent-tool-confirm"` (the shared
marker, see `chat-gateway-agent-tools`), for spawned and attached sessions alike; it is
answered on the dashboard or the session's terminal only. The marker is matched on those two
fields only, and any other `chat-gateway` prompt is rendered as before. The gateway SHALL
also skip a prompt whose title starts with a prefix of `AGENT_TOOL_CONFIRM_TITLE_PREFIXES`
(`Discord send:`, `Discord moderation:`), whatever its metadata, pending state or a server restart, and render no prompt
of a session that has a pending agent-tool confirmation, so a dropped marker cannot expose the
confirmation in Discord. It SHALL remember
each prompt it skipped until that prompt's `prompt_dismiss`/`prompt_cancel` or the session's end,
so a re-sent prompt is never rendered later.


Submitting an answer SHALL require authorization at tier `control` or above. Where the
question arose from a command a specific principal invoked, only that principal SHALL be
able to answer it; where no principal invoked it, any principal holding at least `control`
on that binding SHALL be able to answer.

#### Scenario: Select renders as buttons
- **WHEN** a `prompt_request` of type `select` arrives with options
- **THEN** the gateway SHALL present the options as Discord controls and send the chosen value as `prompt_response`

#### Scenario: Answer elsewhere dismisses the chat prompt
- **WHEN** the same prompt is answered on another surface (e.g. the web UI) first
- **THEN** the gateway SHALL receive `prompt_dismiss` and SHALL disable/remove its Discord controls

#### Scenario: Interaction is acknowledged within 3 seconds
- **WHEN** a user activates a Discord control and the session round-trip exceeds 3 seconds
- **THEN** the gateway SHALL have deferred the interaction immediately and SHALL edit the deferred reply on response, with no Discord "interaction failed" error

#### Scenario: Observer activates a control
- **WHEN** a principal resolving below `control` activates a question's control
- **THEN** no `prompt_response` SHALL be sent and the session SHALL remain blocked

#### Scenario: Bystander answers another principal's question
- **WHEN** a principal other than the invoker activates a control for a question raised by that invoker's command
- **THEN** no `prompt_response` SHALL be sent

#### Scenario: Question from a session no Discord principal invoked
- **WHEN** a session bound by attaching to an existing dashboard session raises a question
- **THEN** any principal holding at least `control` on that binding SHALL be able to answer it

#### Scenario: Agent-tool confirmation is not posted to chat
- **WHEN** an attached session raises an agent-tool confirmation carrying the marker (for example the `discord_send` confirmation)
- **THEN** the gateway SHALL post no control for it and it SHALL be answerable only on the dashboard or terminal

#### Scenario: Marker dropped, prompt still not posted
- **WHEN** an attached session's agent-tool confirmation reaches the gateway without its marker while the server holds a pending confirmation for that session
- **THEN** the gateway SHALL post no control for it

#### Scenario: Skipped prompt replayed after the pending entry ended
- **WHEN** the gateway skipped an agent-tool confirmation, its pending entry then expired or was consumed while the prompt stayed open, and the bridge re-sends the same prompt
- **THEN** the gateway SHALL post no control for it

#### Scenario: Title prefix keeps a confirmation out of chat after a restart
- **WHEN** the dashboard server restarted and the bridge re-sends an open agent-tool confirmation without its marker, titled `Discord send: ...` or `Discord moderation: ...`
- **THEN** the gateway SHALL post no control for it

#### Scenario: Other chat-gateway prompts still render
- **WHEN** a bound session raises a `prompt_request` whose `metadata.plugin` has `pluginId: "chat-gateway"` and a different `kind`
- **THEN** the gateway SHALL render it natively as usual

#### Scenario: Moderation confirmation is not posted to chat
- **WHEN** an attached session raises the confirmation of the `discord_moderate` tool, carrying the same marker
- **THEN** the gateway SHALL post no control for it and it SHALL be answerable only on the dashboard or terminal

#### Scenario: Moderation confirmation with the marker dropped
- **WHEN** an attached session raises a `confirm` titled `Discord moderation: member_ban` whose `metadata.plugin` is absent and for which no confirmation is pending, even after a server restart
- **THEN** the gateway SHALL post no control for it and SHALL log `agent_tool_confirm_not_chat_renderable`

### Requirement: Hard in-session tool policy for spawned sessions
For sessions the gateway spawns, it SHALL load a companion in-session `tool_call`
interceptor that enforces a deny-first tool policy by returning `{ block: true }` for
denied tools (real enforcement, not prompt-text advisory). A tool that is neither
hard-allowed nor hard-denied SHALL escalate to an approval prompt delivered over chat via
`ctx.ui.confirm` (PromptBus); the tool SHALL proceed only on approval. If the approval
prompt is not answered before it times out, the gateway SHALL **fail closed** — the tool
SHALL be blocked (denied), never allowed by default. A spawned session whose configured guard has not announced
readiness for that spawn SHALL receive no chat message; readiness counts only when announced
by the session that spawn resolved to. If it does not arrive within the configurable readiness timeout (default 30 s, `limits.guardReadyS`, `0` = no timeout; an announcement at exactly the timeout is too late),
the gateway SHALL end the session and tell the user it was refused. When the host cannot
deliver the announcement, the gateway SHALL refuse the spawn. Sessions bound by attaching to a
pre-existing dashboard session (source a) SHALL be treated as owner-trusted and SHALL NOT be
gated. The stock guard SHALL block `discord_send` and `discord_moderate` in a spawned session before any policy
decision, whatever the policy allows, and SHALL NOT offer either for approval.

#### Scenario: Denied tool is blocked
- **WHEN** a chat-driven turn in a spawned session attempts a denied tool
- **THEN** the interceptor SHALL block the tool call before it executes

#### Scenario: Risky tool asks for approval over chat
- **WHEN** a spawned session attempts a tool that requires approval
- **THEN** the user SHALL be prompted in-channel to allow or deny
- **AND** the tool SHALL execute only if the user allows it

#### Scenario: Unanswered approval fails closed
- **WHEN** an approval prompt times out with no answer
- **THEN** the tool SHALL be blocked (denied), not allowed

#### Scenario: Guard that never loads ends the session
- **WHEN** a spawned session's companion guard does not announce readiness within the timeout
- **THEN** the gateway SHALL end the session, deliver no message to it, and reply that the session was refused

#### Scenario: Triggering message waits for the guard
- **WHEN** a chat message spawns a session and the guard announces readiness
- **THEN** the triggering message SHALL be delivered only after the announcement

#### Scenario: Readiness from another session is ignored
- **WHEN** a session other than the one the spawn resolved to sends a readiness announcement carrying the spawn's token
- **THEN** the gateway SHALL NOT treat the guard as ready and SHALL NOT deliver the message

#### Scenario: Second message while the guard has not announced
- **GIVEN** a spawn on channel C has resolved but its guard has not announced readiness
- **WHEN** another authorised message arrives on C
- **THEN** the gateway SHALL reply that a session is already starting and SHALL NOT queue or deliver that message

#### Scenario: Resume readiness is bound to the resumed spawn
- **WHEN** an ended session is resumed with a guard configured
- **THEN** readiness SHALL count only from the sessionId the resume spawn resolved to, not the ended session's id

#### Scenario: Delivery failure after readiness keeps the binding
- **WHEN** `send_prompt` fails after the guard announced readiness
- **THEN** the gateway SHALL tell the user the message was not delivered and keep the binding, so the next message is delivered through `send_prompt`

#### Scenario: Host without readiness support refuses the spawn
- **GIVEN** a guard is configured and the host plugin context cannot register a handler for plugin messages
- **WHEN** a message would spawn a session
- **THEN** the gateway SHALL refuse the spawn, start no session, and tell the user

#### Scenario: Attached session is not gated
- **WHEN** the session was bound via attach-to-existing (source a)
- **THEN** the tool guard SHALL NOT be applied

#### Scenario: Readiness timeout is a setting
- **WHEN** `limits.guardReadyS` is 10 and a spawned session's guard announces readiness after 11 seconds
- **THEN** the gateway SHALL end the session and reply that it was refused

#### Scenario: Unlimited readiness timeout
- **WHEN** `limits.guardReadyS` is `0` and the guard has not announced readiness
- **THEN** the gateway SHALL start no timer, SHALL deliver no message to the session, and SHALL deliver the triggering message only after the announcement

#### Scenario: Closing the channel frees a spawn that waits without a timer
- **WHEN** `limits.guardReadyS` is `0`, a spawn waits for an announcement that never comes, and the channel is closed from the dashboard or with `!close`
- **THEN** the gateway SHALL end the pending spawn, clear the held triggering message and accept the next message on that channel

#### Scenario: Agent send is hard-denied despite the policy
- **WHEN** the tool policy lists `discord_send` in `allow` or sets `defaultAction` to `approve`, and a spawned session calls `discord_send`
- **THEN** the guard SHALL block the call without prompting

#### Scenario: Agent moderation is hard-denied despite the policy
- **WHEN** the tool policy lists `discord_moderate` in `allow` or sets `defaultAction` to `approve`, and a spawned session calls `discord_moderate`
- **THEN** the guard SHALL block the call without prompting

### Requirement: Reach dashboard sessions from chat
Sessions started in the dashboard SHALL be reachable from chat without the gateway starting
them. The whole-message commands below SHALL be recognised in a handled channel. The read and
admin commands of `chat-gateway-query-mode` match a closed grammar, are answered in `interactive`
and `query` servers alike, and are never delivered as prompts, and the `!mod` commands of
`chat-gateway-moderation` are matched the same way and never delivered as prompts, but a `query`
server answers them only when its `moderation.allowInQuery` is on; text that does not match one is
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

#### Scenario: Moderation command in an interactive server is not a prompt
- **WHEN** a gateway admin sends the whole message `!mod kick <@u> -- spam` in a bound channel of an `interactive` server
- **THEN** the gateway SHALL handle it as a moderation command and SHALL NOT deliver it to the bound session as a prompt

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
shown and edited on the same surface. The surface SHALL also expose the agent-tool
settings (switch, exposure, read and send allowlists, read auditing and the agent-tool
limits) with their problems and counters. For each enabled server the surface SHALL also show its moderation settings, and warn that chat moderation needs the global ceiling at `operate`.

#### Scenario: Token is not leaked
- **WHEN** the gateway configuration is read back via any surface
- **THEN** the bot token SHALL NOT be returned in plaintext

#### Scenario: Server list shows discovered and configured servers
- **WHEN** the bot is in three servers and one has a record
- **THEN** settings list all three, two marked discovered and inert, each with its live name

#### Scenario: Server row shows index state
- **WHEN** an operator opens a server that has the index enabled
- **THEN** the row shows the indexed message count, size, oldest entry and any problems

#### Scenario: Agent-tool settings are shown with problems
- **WHEN** the operator lists a channel id of a server that is not enabled in `agentTools.read.channels`
- **THEN** the settings show that id with a `guild_not_enabled` problem and the agent-tool counters

#### Scenario: Moderation settings shown per server
- **WHEN** the operator opens the settings of an enabled server
- **THEN** its moderation toggle, action list, assignable roles, agent and query-mode toggles and limits are shown, with `0` marked unlimited
