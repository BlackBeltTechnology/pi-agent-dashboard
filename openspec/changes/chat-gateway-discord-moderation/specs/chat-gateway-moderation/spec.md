## ADDED Requirements

### Requirement: Per-server moderation settings
Each server record SHALL carry an optional `moderation` object (the key the multi-guild change reserves) with `enabled`, an `actions` allowlist, `assignableRoles`, `allowAgents`, `allowInQuery` and numeric limits. Moderation SHALL be off by default, and in a `query` server off until `allowInQuery` is on. Every limit SHALL have a documented default, where `0` means unlimited. Settings SHALL be written only from the dashboard.

#### Scenario: Moderation off by default
- **WHEN** a per-server admin sends `!mod kick` in an enabled server with no `moderation` settings
- **THEN** the request is refused with `moderation_disabled` and nothing happens in Discord

#### Scenario: Query mode needs its own opt-in
- **WHEN** a dashboard write turns `moderation.enabled` on for a `query` server and leaves `allowInQuery` unset
- **THEN** `allowInQuery` stays `false` and moderation there is still refused with `query_mode`

#### Scenario: Action outside the allowlist
- **WHEN** moderation is enabled with `actions` `["member_timeout"]` and an admin requests a ban
- **THEN** the request is refused with `moderation_action_not_allowed`

#### Scenario: Unlimited limits
- **WHEN** a dashboard write sets `confirmTtlSeconds`, `maxPending`, `maxAgentPending`, `perHour`, `agentPerHour` and `perActorPerHour` to `0`
- **THEN** the write is accepted and none of those limits is enforced

#### Scenario: Older plugin keeps the key
- **WHEN** a plugin version without moderation reads and rewrites a server record that holds `moderation`
- **THEN** the `moderation` object is preserved unchanged and the server stays loadable

#### Scenario: Invalid setting rejected
- **WHEN** a dashboard write sets `confirmTtlSeconds` to `-5`
- **THEN** the write is rejected with `invalid_moderation_setting` and nothing is persisted

#### Scenario: Unknown inner key rejected on write
- **WHEN** a dashboard write puts an unknown key inside `moderation`
- **THEN** the write is rejected with `invalid_moderation_setting` naming the key

#### Scenario: Invalid values on boot fail closed
- **WHEN** the stored `moderation` holds `enabled: "yes"`, an unknown action string and `maxPending: -1`
- **THEN** moderation is off, the unknown action is ignored and `maxPending` is 10, the stored file is not rewritten, and the server shows a `moderation_setting_repaired` problem

### Requirement: Cleared limit inputs never mean unlimited
In the settings panel, clearing a numeric moderation limit and saving SHALL omit that key, so its documented default applies and the field shows the default as its placeholder. Unlimited SHALL be written only when `0` is typed explicitly.

#### Scenario: Cleared limit input omits the key
- **WHEN** the operator empties the `perHour` field (stored 20) and saves
- **THEN** the saved `moderation` object has no `rateLimit.perHour`, the default 20 applies, and typing `0` stores `0` as unlimited

### Requirement: Chat moderation needs an adopted server record
A `!mod` in a server with no adopted per-server record (the legacy single-server configuration) SHALL be dropped silently and counted as `guild_not_enabled`: moderation is per server and fails closed, and legacy global admins hold no moderation grant.

#### Scenario: Legacy server
- **WHEN** a legacy admin sends `!mod kick <@u> -- spam` while only the legacy `admins`, `groupChannels` and `teamControls.guildId` keys exist
- **THEN** there is no reply and no audit entry, the counter `guild_not_enabled` is incremented, and nothing is executed

### Requirement: Moderation action set with audit-log reason
The gateway SHALL support exactly these actions: create, rename and delete a text channel; create a role; assign and remove a role on a member; kick; ban; unban; and set or clear a timeout. Each action SHALL require a reason, sent to Discord's audit log prefixed with the source; a chat reason names the requester, an agent reason does not name the session. A created role SHALL carry no permissions, and a created channel no overwrites.

#### Scenario: Reason reaches Discord
- **WHEN** a confirmed kick carries reason `spam`
- **THEN** Discord's audit log records the kick with a reason naming the gateway source, the requester and `spam`

#### Scenario: Agent principal stays internal
- **WHEN** a confirmed agent ban executes
- **THEN** the Discord audit-log reason names the source `agent` and does not contain the session id

#### Scenario: Missing reason
- **WHEN** a moderation request has no reason
- **THEN** it is refused with `moderation_reason_required`

#### Scenario: Created role has no permissions
- **WHEN** a confirmed `role_create` runs
- **THEN** the new role has an empty permission set

#### Scenario: Timeout duration edge cases
- **WHEN** an admin sends `!mod timeout <@u> 0s -- x`, then `... 30d -- x`, then `... off -- x`
- **THEN** the first is refused with `invalid_duration`, the second with `timeout_too_long`, and the third is a valid clear request

### Requirement: Moderation inputs are bounded
A reason SHALL be trimmed first (empty ⇒ `moderation_reason_required`, and the trimmed text is what is stored and sent). The 512-character reason limit SHALL be counted in UTF-16 code units. A created channel or role name empty after normalisation or longer than 100 characters SHALL be refused `moderation_bad_syntax`. An agent `member_timeout` SHALL carry exactly one of `clear: true` or `durationSeconds` ≥ 1, else `bad_request`.

#### Scenario: Whitespace-only reason
- **WHEN** a chat request ends `--` followed only by spaces, or an agent reason is `"   \n\t "`
- **THEN** it is refused with `moderation_reason_required`

#### Scenario: Reason length counts UTF-16 units
- **WHEN** a reason of emoji (two UTF-16 units each) brings prefix plus reason to 513 units but only 257 characters
- **THEN** it is refused with `reason_too_long` and nothing is truncated

#### Scenario: Created channel name normalises to empty
- **WHEN** an admin sends `!mod channel create !!! -- x`
- **THEN** it is refused with `moderation_bad_syntax`

#### Scenario: Created name over 100 characters
- **WHEN** an admin sends `!mod role create` with a 101-character name
- **THEN** it is refused with `moderation_bad_syntax`, and a 100-character name is accepted

#### Scenario: Timeout with both clear and duration
- **WHEN** an agent calls `member_timeout` with `clear: true` and `durationSeconds` 60, then with neither
- **THEN** both calls fail with `bad_request` before any lookup

### Requirement: Chat moderation command
A whole-message `!mod` SHALL be handled, and counted by the query layer's per-user limit, as an admin command in an `interactive` server or in a `query` server with `moderation.allowInQuery` on (else `query_mode`), then pass the next requirement's authorization. A disarmed server or a gateway without team controls SHALL refuse it. A refusal SHALL reply `Refused: <reason>.` and be audited when that reply is posted. A `!mod` without a server SHALL be dropped silently.

#### Scenario: Team controls not configured
- **WHEN** the gateway runs without the team-controls layer and a server admin sends `!mod kick <@u> -- spam`
- **THEN** the bot replies `Refused: team_controls_required.`, the refusal is audited when that reply is posted, and nothing is parsed, confirmed or executed

#### Scenario: Command flood
- **WHEN** a non-admin sends 500 `!mod` commands within the rate window and an earlier disarm entry exists
- **THEN** commands past `query.commandsPerWindow` are refused by the layer's per-user limit with `command_rate_limited`, one reply and one aggregated entry per burst, and the disarm entry stays in the log

#### Scenario: Disarmed server
- **WHEN** a server has been disarmed and an admin with `operate` sends a `!mod` command
- **THEN** it is refused with `disarmed`

#### Scenario: Malformed command
- **WHEN** an admin sends `!mod ban` with no target
- **THEN** the bot replies with `moderation_bad_syntax` and a usage line, and nothing is executed

#### Scenario: Interactive server and opted-in query server
- **WHEN** a qualified admin sends `!mod kick <@u> -- spam` in an `interactive` server and in a `query` server with `allowInQuery` on, both with moderation enabled
- **THEN** the command is handled in both and is not delivered to any session as a prompt

#### Scenario: Query server without the opt-in
- **WHEN** a qualified admin sends `!mod kick <@u> -- spam` in a `query` server whose moderation is enabled but whose `allowInQuery` is off
- **THEN** the bot replies `Refused: query_mode.`, the refusal is audited when that reply is posted, and no session is prompted

#### Scenario: Throttled refusal reply is not audited
- **WHEN** a non-admin's `!mod` refusals exceed `limits.refusalRepliesPerMinute` in one channel
- **THEN** replies past the limit are not posted, they are counted as `refusal_throttled`, and no entry is written for them

#### Scenario: Disabled server gives no usage text
- **WHEN** an admin sends a malformed `!mod ban` in a server whose moderation is disabled
- **THEN** the reply is `Refused: moderation_disabled.` and no usage line is shown, because the enabled check runs before parsing

#### Scenario: Command in a DM
- **WHEN** a user sends `!mod kick <@u> -- spam` in a direct message
- **THEN** the message is dropped with no reply and no audit entry

#### Scenario: Command in a bound channel
- **WHEN** a qualified admin sends `!mod kick <@u> -- spam` inside a channel bound to a workspace
- **THEN** the tier is resolved from the server record, not from the binding, and the command is not delivered to the bound session

### Requirement: Chat moderation needs server admin and an explicit operate mapping
A `!mod` request SHALL be accepted only when the author is a gateway admin of the server it came from (`not_admin` otherwise) AND server-scoped authorization of verb `mod_<action>` at `operate` permits it (`insufficient_tier` otherwise). `operate` SHALL come only from an explicit user-id mapping in that server; a role mapping SHALL NOT grant it. Authority in one server SHALL NOT apply in another. The requester's own Discord permissions are not required.

#### Scenario: Non-admin uses !mod
- **WHEN** an allowlisted user who is not in the server's `admins` sends `!mod kick <@u> -- spam`
- **THEN** the bot replies `Refused: not_admin.` and the command log records the refusal

#### Scenario: Admin without operate tier
- **WHEN** a server admin whose server-scoped tier resolves to `control` sends a `!mod` command
- **THEN** it is refused with `insufficient_tier`

#### Scenario: Operate mapping without admin status
- **WHEN** a user explicitly mapped to `operate` in that server but not listed in its `admins` sends a `!mod` command
- **THEN** it is refused with `not_admin`

#### Scenario: Role-derived tier never moderates
- **WHEN** a server admin holds a role mapped to `control` and has no explicit `operate` mapping
- **THEN** their `!mod` command is refused with `insufficient_tier`, and a configuration that maps a role to `operate` is rejected with `role_cannot_map_to_operate_requires_explicit_identifier`

#### Scenario: Admin with an explicit operate mapping
- **WHEN** a server admin who is explicitly mapped to `operate` sends a valid `!mod` command and every other check passes
- **THEN** the gate is passed and a confirmation is posted

#### Scenario: Requester's own Discord permissions are not required
- **WHEN** a server admin with an explicit `operate` mapping, who holds no Ban Members permission in Discord, confirms a valid ban and the bot holds Ban Members
- **THEN** the ban is executed, because authority is the gateway's and only the bot's permissions and role position bound the action

#### Scenario: Ceiling below operate
- **WHEN** a server admin has an explicit `operate` mapping but the effective ceiling is `control`
- **THEN** the command is refused with `insufficient_tier`

#### Scenario: Authority in another server
- **WHEN** a user who is an admin with an `operate` mapping in server X sends `!mod` in server Y where they hold neither
- **THEN** it is refused with `not_admin`

### Requirement: Chat moderation requires an invoker confirmation
An accepted `!mod` request SHALL post a Yes/No confirmation with mentions disabled and SHALL execute only on Yes. A click SHALL re-run the whole gate, mode gate included, and be accepted only from the invoker; other clicks SHALL be refused with `not_invoker` without consuming or editing the confirmation. No SHALL cancel it, and one unanswered within `confirmTtlSeconds` (`0` = never) SHALL expire. The confirmation SHALL be consumed before any Discord call, so it runs at most once.
#### Scenario: Another admin clicks Yes
- **WHEN** a second admin clicks Yes on a confirmation raised by the first admin
- **THEN** nothing is executed, `not_invoker` is audited, the message is not edited, and the invoker can still answer

#### Scenario: Repeated bystander clicks
- **WHEN** one bystander clicks the confirmation ten times
- **THEN** the command log gains one `not_invoker` entry for that request and clicker, and the confirmation is unchanged

#### Scenario: Two fast Yes clicks
- **WHEN** the invoker's Yes is delivered twice before the first action finishes
- **THEN** the action runs once, the second click is ignored, and one `permitted` entry exists

#### Scenario: Confirmation expires
- **WHEN** `confirmTtlSeconds` is 120 and nobody answers for 120 seconds
- **THEN** the buttons are removed, `moderation_confirm_expired` is audited, and a later click does nothing

#### Scenario: Invoker loses authority before clicking
- **WHEN** the invoker is removed from the server's `admins` after the confirmation is posted and then clicks Yes
- **THEN** the action is refused with `not_admin` and nothing is executed

#### Scenario: Delete the current channel
- **WHEN** the invoker confirms deleting the channel that holds the confirmation
- **THEN** the channel is deleted, the failed result post is ignored, and the audit outcome is unchanged

#### Scenario: Distinct bystanders each leave one entry
- **WHEN** 150 different channel members each click one confirmation once
- **THEN** the log gains one `not_invoker` entry per clicker (a documented residual that can push older entries out of the ring), and the counter reads 150

#### Scenario: Confirm TTL above the timer maximum
- **WHEN** `confirmTtlSeconds` is 2592000
- **THEN** the expiry timer is clamped to 2147483647 ms, the stored value is unchanged, and the confirmation neither expires at once nor overflows the timer

### Requirement: Pending confirmations are cancelled when their basis ends
When a server is disabled, removed, switched mode or disarmed, its `moderation.enabled` goes false, or `moderation.allowInQuery` is withdrawn in a `query` server, its pending chat confirmations SHALL be cancelled with their buttons removed and one `moderation_cancelled` entry each, and a later click SHALL do nothing.

#### Scenario: Query opt-in withdrawn before the click
- **WHEN** a confirmation is pending in an opted-in `query` server and the operator turns `moderation.allowInQuery` off
- **THEN** the buttons are removed, one `moderation_cancelled` entry is audited for it, and a later click does nothing

#### Scenario: Query opt-in withdrawn and a click already in flight
- **WHEN** the invoker's Yes arrives after `allowInQuery` was turned off and the record was not yet purged
- **THEN** the click is refused with `query_mode` and nothing is executed

### Requirement: Moderation text shown to a human is escaped
Every Discord-sourced name and every requester or agent reason SHALL be shown in a confirmation or result as an escaped code span next to its id, with backticks, newlines and control characters replaced, and SHALL never be shown as markup. An agent's reason SHALL be labelled as agent-supplied. Confirmations and result posts SHALL be sent with mentions disabled.

#### Scenario: Name imitates a trusted line
- **WHEN** a role is named `x\nReason: approved by owner`
- **THEN** the confirmation shows it inside one code span with its id and no extra `Reason:` line

#### Scenario: Target name cannot ping
- **WHEN** the target's display name contains `@everyone`
- **THEN** the confirmation and the result post show the name as text and no one is mentioned

### Requirement: Pending confirmations are capped by a setting
A server SHALL hold at most `maxPending` unanswered chat confirmations and, separately, at most `maxAgentPending` live agent previews, where `0` means unlimited for each. A request over its cap SHALL be refused with `moderation_too_many_pending` before any confirmation is posted or preview issued, and SHALL NOT count against the rate limits. Agent previews SHALL NOT use chat slots.

#### Scenario: Too many pending confirmations
- **WHEN** `maxPending` is 2, two confirmations are unanswered and an admin sends a third accepted `!mod` request
- **THEN** it is refused with `moderation_too_many_pending`, no confirmation is posted and no rate limit is charged

#### Scenario: Agent previews have their own cap
- **WHEN** `maxAgentPending` is 1 and one agent preview is live
- **THEN** a second agent preview in that server is refused with `moderation_too_many_pending`, and a chat request is not refused for it

#### Scenario: Agent previews cannot starve the human path
- **WHEN** a looping session holds every `maxAgentPending` slot with unanswered previews and an admin sends a valid `!mod ban`
- **THEN** the confirmation is posted, because chat requests are counted only against `maxPending`

#### Scenario: Unlimited agent previews
- **WHEN** `maxAgentPending` is `0`
- **THEN** no agent preview is refused for the number pending

### Requirement: Agent moderation tool with confirmation
A pi agent SHALL moderate only through the bridge tool `discord_moderate`, when agent tools and the server's `moderation.allowAgents` are on. It SHALL be blocked without a UI, SHALL show the human the server-resolved names via `ctx.ui.confirm`, and SHALL execute only after approval through a session-bound `previewId`, consumed before execution and re-validated in full. The moderation record, not the agent-tool registry, decides whether a preview is live.

#### Scenario: Headless session
- **WHEN** the moderation tool is called in a session without an interactive UI
- **THEN** it returns `blocked` and nothing reaches the gateway or Discord

#### Scenario: Human declines
- **WHEN** the user answers No to the moderation confirmation
- **THEN** the tool returns `denied`, nothing is executed, and `moderation_cancelled` is audited

#### Scenario: Agent moderation in a query server
- **WHEN** an agent requests a kick in a `query` server whose `moderation.allowInQuery` is off
- **THEN** it is refused with `query_mode` and no confirmation is shown

#### Scenario: Server disabled while an agent confirmation is open
- **WHEN** the server stops being enabled, or is disarmed, after the preview and before the user answers
- **THEN** the preview is dropped and one `moderation_cancelled` entry is audited, the open confirmation stays unrenderable in chat until the bridge answers, the commit fails with `moderation_preview_invalid` (clearing its registry entry), and nothing is executed

#### Scenario: Agent tools off for the server
- **WHEN** an agent requests a timeout in a server whose `moderation.allowAgents` is false
- **THEN** it is refused with `moderation_agent_disabled` and no confirmation is shown

#### Scenario: Settings change between confirm and commit
- **WHEN** the operator disables the action after the user approved but before commit
- **THEN** the commit is refused with `moderation_action_not_allowed`

#### Scenario: Concurrent commits of one preview
- **WHEN** two `discord/moderate` requests carry the same `previewId` at once
- **THEN** at most one executes and the other fails with `moderation_preview_invalid`

#### Scenario: confirmTtlSeconds above agentToolConfirmPendingS
- **WHEN** `confirmTtlSeconds` is 900, `limits.agentToolConfirmPendingS` is 600, and the user approves at 700 seconds
- **THEN** the preview is still valid and the commit trusts the moderation record and proceeds, and the confirmation was never posted in Discord

#### Scenario: Preview expired before the human answered
- **WHEN** the user approves after `confirmTtlSeconds` has elapsed
- **THEN** the commit fails with `moderation_confirm_expired` and nothing is executed

#### Scenario: Cancel from another session
- **WHEN** a session other than the preview's session calls `discord/moderate-cancel` with the `previewId`
- **THEN** the preview is not cancelled and the call fails with `moderation_preview_invalid`

#### Scenario: Another session's commit does not burn the preview
- **WHEN** session S2 calls `discord/moderate` with S1's live `previewId`
- **THEN** it fails with `moderation_preview_invalid`, S1's record is untouched, and S1 can still commit it

#### Scenario: Preview survives a bridge reconnect
- **WHEN** the bridge socket of the preview's session drops and reconnects with the same session id before the TTL
- **THEN** the preview stays live and a commit executes, and it ends only by TTL, commit, cancel or the host's session-ended event

#### Scenario: Lane timeout after the action may have run
- **WHEN** the agent commit does not finish within the request lane's timeout
- **THEN** the tool returns `unknown` with `detail` `timeout`, the `permitted` entry stays authoritative, and a retry fails with `moderation_preview_invalid`

#### Scenario: Preview does not charge the budget
- **WHEN** an agent previews 30 requests that the human declines, with `agentPerHour` 10
- **THEN** none is counted against `agentPerHour` or the chat budgets, and human admins are never refused `moderation_rate_limited` because of them

#### Scenario: Agent preview expires unanswered
- **WHEN** an agent preview reaches `confirmTtlSeconds` with no answer, or its session ends first
- **THEN** the preview is dropped, one `refused` entry (`moderation_confirm_expired`, or `moderation_cancelled` for a session end) is audited, and a later commit fails `moderation_preview_invalid`

### Requirement: Agent moderation results do not disclose server data
The result of `discord_moderate` returned to the model SHALL carry only an outcome, a reason and an optional `detail`: the permission name, platform code, HTTP status or error class, or `timeout`. It SHALL NOT carry member, role, channel or server names, or whether an id exists. Names SHALL appear only in the human dialog.

#### Scenario: Result carries no names
- **WHEN** an agent's moderation request is confirmed and executed
- **THEN** the tool result holds the outcome and no member, role, channel or server name

### Requirement: Target refusals are opaque to the model
Every target, role or channel refusal of an agent request SHALL reach the model as `target_not_permitted`, so it cannot learn who owns or administers a server; the audit entry keeps the specific reason.

#### Scenario: Target refusal is opaque to the model
- **WHEN** an agent requests a kick of the server owner
- **THEN** the tool returns `target_not_permitted` and the audit entry holds `target_is_owner`

#### Scenario: Unknown id is indistinguishable from a protected one
- **WHEN** an agent requests a ban of an id that does not exist and then of the owner
- **THEN** both calls return `target_not_permitted`

#### Scenario: Existing unprotected id reaches the dialog (stated residual)
- **WHEN** an unbound session previews a ban of an existing, unprotected member in a server that allows agents
- **THEN** a human dialog is shown and no name reaches the model, so the session can learn only that an id it already held exists, and only after the human answers

### Requirement: Agent moderation confirmations are not answerable from chat
The agent moderation confirmation SHALL carry the shared marker of `chat-gateway-agent-tools`, and its preview SHALL register in that pending registry for `confirmTtlSeconds` (`0` = until the session ends). It SHALL be answerable only on the dashboard or terminal and SHALL NOT be rendered into any chat channel, even in a bound or attached session whose marker was lost.

#### Scenario: Attached session asks to ban
- **WHEN** a session attached to a Discord thread calls the moderation tool and its confirmation is raised
- **THEN** no buttons are posted in the thread and the prompt is answerable on the dashboard

#### Scenario: Marker dropped
- **WHEN** the bridge could not copy the marker and the confirmation title begins `Discord moderation:`, even when no confirmation is pending
- **THEN** the gateway still posts no control for it and logs `agent_tool_confirm_not_chat_renderable`

### Requirement: Gateway-spawned sessions cannot moderate
A session the gateway spawned SHALL NOT moderate. The in-session tool guard SHALL deny `discord_moderate` even when `toolPolicy.allow` lists it. The gateway SHALL also refuse moderation requests from such a session with `spawned_session_denied` when no guard is loaded.

#### Scenario: Operator allow-lists the tool
- **WHEN** `toolPolicy.allow` lists the moderation tool and a gateway-spawned session calls it
- **THEN** the guard blocks the call

#### Scenario: Spawned session without a guard
- **WHEN** no `toolPolicy` is configured and a gateway-spawned session calls the moderation tool
- **THEN** the gateway refuses the request with `spawned_session_denied` and nothing is executed

### Requirement: Gateway-bound sessions moderate only their own server
A session bound to the chat gateway SHALL moderate only its own server, by the definition of bound and own server in `chat-gateway-agent-tools` (all its bindings; a DM binding beside a server binding leaves no own server). A request naming another server, or one whose own server cannot be resolved, SHALL be refused with `cross_guild_denied`; a disarmed own server SHALL refuse it `disarmed`. A session with no gateway binding MAY moderate any enabled server that allows agents.

#### Scenario: Attached session targets another server
- **WHEN** a session attached in server X requests a ban in server Y, which allows agents
- **THEN** it is refused with `cross_guild_denied` and no confirmation is shown

#### Scenario: Bound session in its own server
- **WHEN** a session attached in server X requests a kick in server X
- **THEN** the gate continues and the human confirmation is shown on the dashboard

#### Scenario: Session bound to a server and a DM
- **WHEN** a session with a binding in server X and a DM binding requests a kick in server X
- **THEN** it is refused with `cross_guild_denied`, because it has no own server

#### Scenario: Own server disarmed
- **WHEN** a session attached in server X requests a kick in server X after X was disarmed
- **THEN** it is refused with `disarmed` and no confirmation is shown

#### Scenario: Unbound dashboard session
- **WHEN** a session with no gateway binding requests a kick in server Y, which allows agents
- **THEN** the gate continues

### Requirement: Protected targets and role hierarchy
Moderation SHALL never act on the server owner, the bot, or a member or role at or above the bot's highest role; a chat request SHALL also be refused at or above the requester's highest role unless the requester is the owner. These member checks apply to every member-targeting action. Managed, tier-mapped, permission-granting and non-`assignableRoles` roles, gateway-managed channels, and any channel that is not a plain text channel SHALL be refused, each with a specific reason.

#### Scenario: Kick the owner
- **WHEN** a moderation request targets the server owner
- **THEN** it is refused with `target_is_owner`

#### Scenario: Target outranks the bot
- **WHEN** a ban targets a member whose highest role is above the bot's highest role
- **THEN** it is refused with `target_outranks_bot` before any confirmation is posted

#### Scenario: Target is a gateway admin
- **WHEN** a request targets a member listed in the server's `admins` or holding an `operate` mapping in its `principals`
- **THEN** it is refused with `target_is_gateway_admin` before any confirmation is posted

#### Scenario: Role assignment to the owner
- **WHEN** a request assigns an allowed role to the server owner
- **THEN** it is refused with `target_is_owner`

#### Scenario: Assign a tier-mapped role
- **WHEN** a request assigns a role that a tier mapping lists
- **THEN** it is refused with `role_mapped_to_tier`

#### Scenario: Role outside the assignable list
- **WHEN** a request assigns a role that is not in `assignableRoles`, even one with no dangerous permission
- **THEN** it is refused with `role_not_assignable`

#### Scenario: Assignable list empty
- **WHEN** `assignableRoles` is absent and a request assigns any role
- **THEN** it is refused with `role_not_assignable`

#### Scenario: Delete a bound channel
- **WHEN** a request deletes a channel listed in the server's opted-in channels, its indexed channels or a provisioned binding
- **THEN** it is refused with `channel_managed_by_gateway`

#### Scenario: Delete a channel used only by a binding
- **WHEN** a request deletes a channel referenced by a persisted binding or by a fixed `teamControls.bindings.<ws>.channelId` but not listed as opted in or provisioned
- **THEN** it is refused with `channel_managed_by_gateway`

#### Scenario: Created channel parent is not a category
- **WHEN** an admin creates a channel `in` a text channel id, or an unknown id, or an id of another server
- **THEN** the first is refused with `unsupported_channel_type`, the others with `target_not_found`, and a gateway-provisioned category parent is accepted

#### Scenario: Delete a category
- **WHEN** a request deletes or renames a category, voice, forum or announcement channel, or the server's rules channel
- **THEN** it is refused with `unsupported_channel_type` and no confirmation is posted

#### Scenario: Ban a user who is not a member
- **WHEN** an admin bans a snowflake that resolves to a user but not a member
- **THEN** the request passes the member checks and, if confirmed, the ban is created by id

#### Scenario: Ban an id that resolves to nothing
- **WHEN** an admin bans a snowflake that no lookup resolves
- **THEN** it is refused with `target_not_found`

#### Scenario: Unban an id that is not banned
- **WHEN** an admin unbans an id absent from the ban list
- **THEN** it is refused with `not_banned`

### Requirement: Moderation calls pass the per-server write gate
Every moderation call to Discord SHALL pass the same per-server write gate as every other adapter write, and SHALL be refused with `guild_not_enabled` when its server is not enabled, before any Discord call. `moderation.enabled` SHALL be required in addition to that gate, never instead of it.

#### Scenario: Call for a server that is not enabled
- **WHEN** a moderation call names a server that is not enabled, even if a caller skipped the earlier gate steps
- **THEN** it is refused with `guild_not_enabled` and nothing is sent to Discord

### Requirement: Discord permission failures are graceful
Before a confirmation is shown, and again at execution, the gateway SHALL check against freshly fetched bot state that the bot holds the Discord permission each action needs, using the target channel's permissions for channel actions. A missing permission SHALL be refused with `missing_permission`, naming the permission. A refusal returned by Discord SHALL be reported as `platform_refused` with the platform code and SHALL NOT be retried automatically.

#### Scenario: Bot lacks Ban Members
- **WHEN** a ban is requested and the bot lacks Ban Members
- **THEN** the reply is `Refused: missing_permission (BanMembers).`, the audit `detail` is `BanMembers`, and no confirmation is posted

#### Scenario: Permission removed after confirm
- **WHEN** the bot loses Kick Members after the invoker clicked Yes and Discord rejects the kick
- **THEN** the gateway replies `Refused: platform_refused (50013).` and the audit entry records the Discord code 50013

#### Scenario: Channel overwrite denies the bot
- **WHEN** the bot holds Manage Channels guild-wide but a channel overwrite denies it in the target channel
- **THEN** a rename of that channel is refused with `missing_permission`

### Requirement: Discord failures are classified
A Discord rejection with a numeric API code SHALL be `platform_refused` with that code as `detail`. Any other failure (HTTP 5xx, a rate-limit error, a network error, a client that is not ready) and an enabled server absent from the Discord client SHALL be `discord_unavailable` with the HTTP status or error class as `detail`. An unexpected exception SHALL be `moderation_internal_error`. None is retried.

#### Scenario: Failure without an API code
- **WHEN** a confirmed ban fails with a rate-limit error that carries no numeric code
- **THEN** the reply is `Refused: discord_unavailable (RateLimitError).`, the audit result entry carries that `detail`, and the call is not retried

#### Scenario: Server absent from the Discord client
- **WHEN** the bot was removed from an enabled server and a confirmation there is answered Yes, or an agent previews for it
- **THEN** the request is refused with `discord_unavailable` and no Discord mutation is attempted

#### Scenario: Internal exception
- **WHEN** the authorization check throws an unexpected error during a `!mod` request
- **THEN** the reply is `Refused: moderation_internal_error.`, one refused entry is written, nothing is executed and no pending record remains

### Requirement: Moderation rate limits are settings
Confirmed chat requests SHALL be limited per server by `rateLimit.perHour`, agent commits by `agentPerHour`, agent previews by `agentPreviewPerHour` and each principal by `perActorPerHour`, over a rolling hour, `0` = unlimited. A commit SHALL be charged only once its Yes passes the gate and its `permitted` entry is written, a preview before any Discord lookup; a request over a limit SHALL be refused `moderation_rate_limited`. Refused, declined and expired requests SHALL NOT be charged.
#### Scenario: Per-actor limit reached
- **WHEN** `perActorPerHour` is 2, two of an admin's requests were confirmed within the hour, and the admin sends a third
- **THEN** it is refused with `moderation_rate_limited`

#### Scenario: Declined requests are free
- **WHEN** an admin raises ten requests with `perHour` 3 and answers No to each
- **THEN** none is charged and a later request is not refused for rate

#### Scenario: Confirmed op is not re-counted
- **WHEN** an agent preview passed `agentPreviewPerHour` and its human then confirms
- **THEN** the commit and a cancel are not counted against `agentPreviewPerHour`, so the confirmed op is never refused for the preview budget

#### Scenario: Agent preview flood
- **WHEN** one session sends previews past `agentPreviewPerHour`
- **THEN** the excess is refused `moderation_rate_limited` before any Discord lookup, and the command log holds one entry per server and reason and window, not one per call

#### Scenario: Rolling hour edge
- **WHEN** `perHour` is 1, a charge is made at t0, and a request is confirmed at t0+3599999 ms and again at t0+3600000 ms
- **THEN** the first is refused with `moderation_rate_limited` and the second is allowed, and a wall-clock jump neither frees nor locks the limit

#### Scenario: Failed Discord call keeps its charge
- **WHEN** `perHour` is 1 and the first confirmed ban fails at Discord with code 50013
- **THEN** the charge is kept, and the next confirmed request is refused with `moderation_rate_limited`

#### Scenario: Unlimited
- **WHEN** `perHour`, `agentPerHour` and `perActorPerHour` are all `0`
- **THEN** no request is refused for rate

### Requirement: Moderation is audited before it executes
A refused moderation request whose chat reply is posted (or an agent request), and each cancelled, expired, session-ended or unauthorized-click confirmation, SHALL write one `refused` command-log entry with its reason. The `permitted` entry SHALL be written only after the human's Yes and the final gate, durably and before Discord is called; if that fails it SHALL refuse with `audit_unavailable` and execute nothing. A later Discord failure SHALL add a `refused` `result` entry.
#### Scenario: Executed ban
- **WHEN** a ban is requested, confirmed and executed
- **THEN** the log holds exactly one `permitted` entry for `mod_member_ban`, written before the ban was sent

#### Scenario: Unanswered request leaves no permitted entry
- **WHEN** a confirmation expires unanswered
- **THEN** the log holds one `refused` entry with `moderation_confirm_expired` and no `permitted` entry

#### Scenario: Audit store unavailable
- **WHEN** the command-log write fails after the invoker clicked Yes
- **THEN** the request is refused with `audit_unavailable` and nothing is sent to Discord

#### Scenario: Failed write leaves no phantom authorization
- **WHEN** the `permitted` write fails, and a later ordinary entry is appended successfully
- **THEN** the log, in memory and after a reload, holds no `permitted` entry for the refused request

#### Scenario: Older reader
- **WHEN** a plugin version without moderation loads a log containing moderation entries
- **THEN** it loads them as ordinary permitted or refused entries

### Requirement: Moderation log entries carry complete evidence
Moderation entries SHALL carry the server, principal, verb `mod_<action>`, target id and channel id (the invoking channel for chat, an empty string for an agent call). An agent moderation denial SHALL be logged under `mod_<action>` with `moderation_cancelled`. Agent-preview refusals SHALL share one entry per server, reason and window, whatever the session or target, and an agent-chosen server id that is not configured SHALL NOT create its own entry.

#### Scenario: Create actions name the server
- **WHEN** a `channel_create` is authorized
- **THEN** its entry's target is the server id and the parent id, if any, is in `detail`

#### Scenario: Entries carry a channel id
- **WHEN** a chat moderation request is refused in channel C and an agent preview is refused
- **THEN** the first entry's channel id is C, the second's is an empty string, and both survive a reload of the log

#### Scenario: Agent moderation denied by the human
- **WHEN** the user answers No to an agent moderation confirmation for a ban
- **THEN** the log holds one `refused` entry with verb `mod_member_ban` and reason `moderation_cancelled`, and no `agent_send` entry

#### Scenario: Repeated identical preview refusals
- **WHEN** a session's preview is refused `target_is_owner` 500 times in one window
- **THEN** the log holds one entry for it and an earlier disarm entry is still present

#### Scenario: Preview refusals with varying targets and sessions
- **WHEN** 500 previews, each from a different session and naming a different target id or guild id, are refused with the same reason in one window
- **THEN** the log holds at most one entry per configured server and reason, and an earlier disarm entry is still present

### Requirement: Moderation reasons are a closed set
Every refusal of a moderation request SHALL use exactly one reason from the set in the design (§D12): this change's reasons plus the inherited gate reasons it lists, and no other. The chat reply `Refused: <reason>.` and the audit reason SHALL be that reason; only an agent tool result SHALL collapse target reasons to `target_not_permitted`. A reason outside the set SHALL be a defect.

#### Scenario: Inherited reason keeps its name
- **WHEN** a server admin with no principal mapping at all sends `!mod kick <@u> -- spam`
- **THEN** the refusal is `no_principal_mapping`, a name from the inherited set

#### Scenario: Adapter without moderation support
- **WHEN** the connected adapter does not implement moderation
- **THEN** the request is refused with `moderation_unsupported` and nothing is executed

#### Scenario: Adapter disconnected
- **WHEN** an agent previews a request while the adapter is not connected
- **THEN** it is refused with `discord_unavailable`

### Requirement: Missing bot permissions are an advisory from cached state
The dashboard SHALL show, per enabled server, an advisory problem `moderation_missing_permission:<Perm>` for each allowed action whose guild-level permission the bot lacks, computed from the bot's cached state with no Discord request, refreshed on a server-list change and on each settings save. It SHALL be labelled advisory and SHALL NOT allow or refuse an action; execution SHALL check freshly fetched state.

#### Scenario: Rendering costs no Discord call
- **WHEN** the dashboard projects the server list ten times between server-list changes
- **THEN** the advisory is reused from the cache and no Discord request is made

#### Scenario: Advisory names the permission
- **WHEN** `member_ban` is allowed for a server and the cached bot lacks Ban Members
- **THEN** the server shows `moderation_missing_permission:BanMembers` as an advisory

#### Scenario: Bot state not cached
- **WHEN** the bot or the server is not in the cache
- **THEN** no advisory is shown and nothing is refused because of it

#### Scenario: Advisory is not authoritative
- **WHEN** the cached state says the bot lacks Kick Members but a fresh fetch shows it holds it
- **THEN** a kick is not refused for the advisory
