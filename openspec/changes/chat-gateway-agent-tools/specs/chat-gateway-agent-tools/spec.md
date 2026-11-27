## ADDED Requirements

### Requirement: Agent tools are off by default and server-authoritative
The bridge entry SHALL register `discord_servers`, `discord_channels`, `discord_read`, `discord_search`, `discord_send` and any later chat-gateway tool only while the server reports them enabled (`agentTools.enabled` true, default `false`, gateway connected), with the exposure `agentTools.exposure` (`direct` default). Every handler SHALL refuse with `agent_tools_disabled` while off, run only for hub-local sessions, and use only the host-attributed session id.

#### Scenario: Fresh install registers no tools
- **WHEN** a pi session starts and `agentTools` is absent
- **THEN** no `discord_*` tool is registered in that session

#### Scenario: Switch turned off while tools are registered
- **WHEN** the operator disables agent tools and a session calls `discord_read`
- **THEN** the call fails with `agent_tools_disabled` and no Discord request is made

#### Scenario: Remote device session registers nothing
- **WHEN** a session admitted as a paired device asks for the tool status
- **THEN** the status request fails with `origin_denied` and the bridge registers no `discord_*` tool, hiding any it had

#### Scenario: Stale registration on a remote session
- **WHEN** a session admitted as a paired device calls a `discord_*` tool it still had registered
- **THEN** the call fails with `origin_denied`

#### Scenario: Gateway not connected
- **WHEN** `agentTools.enabled` is `true` but the Discord adapter is not connected
- **THEN** the status reports not enabled and a direct call fails with `discord_unavailable`

#### Scenario: Exposure setting applies
- **WHEN** `agentTools.exposure` is `codemode` and agent tools are enabled
- **THEN** the tools are registered with exposure `codemode` under the namespace `discord`

#### Scenario: Deferred exposure applies
- **WHEN** `agentTools.exposure` is `deferred` and agent tools are enabled
- **THEN** the tools are registered with exposure `deferred` and are reachable through tool search

#### Scenario: Payload session id is ignored
- **WHEN** a request payload names a session id other than the requesting session's
- **THEN** the server evaluates scope, binding and spawn state for the host-attributed session id only

### Requirement: Tool registration never blocks a turn
The bridge SHALL refresh the server's tool status without awaiting it: on session start, on bridge readiness and before each agent run, with at most one request in flight and the last status cached. A reply SHALL be applied when it arrives. `unavailable`, `timeout`, `no_handler`, `bad_request` and other errors SHALL change nothing; `agent_tools_disabled` status SHALL re-register the tools as `hidden`.

#### Scenario: Stalled server does not stall the turn
- **WHEN** the plugin server does not answer a status request for 15 seconds
- **THEN** agent runs start without waiting for it and the tool set is unchanged

#### Scenario: Disabled hides registered tools
- **WHEN** the status reply says not enabled and the tools were registered
- **THEN** they are re-registered `hidden` and no longer appear in tool search

#### Scenario: Enabled from the dashboard
- **WHEN** the operator enables agent tools
- **THEN** a session's tools appear when its next status refresh is applied, at the latest from the agent run after that

### Requirement: The bot token stays on the server
Every Discord call made for an agent tool SHALL run in the chat-gateway server entry on its existing bot connection. No request, reply, tool result, log line or session environment SHALL contain the bot token.

#### Scenario: Read reply carries no credential
- **WHEN** `discord_read` succeeds
- **THEN** the lane reply and the tool result contain message data only and no token

### Requirement: Reads are scoped to enabled servers and the read allowlist
A channel SHALL be readable by agent tools only when its server is enabled and not disarmed, the channel is listed in `agentTools.read.channels` or its server in `agentTools.read.guilds` (a thread inherits its parent), and the bot can currently view it, including for index-served reads. Direct messages SHALL NOT be readable. Listing tools SHALL name only servers and channels that pass these rules. Otherwise reads fail with `guild_not_enabled`, `not_readable` or `disarmed`.

#### Scenario: Channel of a disabled server
- **WHEN** `discord_read` names a channel listed in `agentTools.read.channels` whose server is not enabled
- **THEN** the call fails with `guild_not_enabled`

#### Scenario: Unlisted channel
- **WHEN** `discord_read` names a channel of an enabled server that neither read list covers
- **THEN** the call fails with `not_readable`

#### Scenario: Whole server listed
- **WHEN** a server is in `agentTools.read.guilds` and `discord_channels` is called for it by an unbound session
- **THEN** every text channel the bot can view there is listed as readable

#### Scenario: Allowlist is the consent for a non-indexed channel
- **WHEN** a channel is listed in `agentTools.read.channels`, its server's message index does not include it, and an unbound session calls `discord_read` on it
- **THEN** the read is served live and succeeds without any index opt-in

#### Scenario: Unscoped server stays hidden
- **WHEN** an enabled server is in no read list and has no sendable channel
- **THEN** `discord_servers` does not list it

#### Scenario: Indexed channel the bot can no longer view
- **WHEN** a channel's messages are in the index but the bot has lost View Channel on it
- **THEN** `discord_read` fails and serves nothing from the index

#### Scenario: Disarmed server refuses reads
- **WHEN** the target channel's server is disarmed or the global latch is on
- **THEN** the call fails with `disarmed`

### Requirement: Unlisted ids get one uniform refusal
An id in no agent-tool list SHALL fail `not_readable` (reads) or `not_sendable` (sends), whether it does not exist, belongs to a disabled server or to a server the bot is not in. `guild_not_enabled` SHALL be returned only for a LISTED id of a server that is not enabled, so a prompt-injected agent cannot probe which ids exist where.

#### Scenario: Nonexistent channel id
- **WHEN** `discord_read` names a channel id that exists nowhere and is in no list
- **THEN** the call fails with `not_readable`

#### Scenario: Unlisted channel of a disabled server
- **WHEN** `discord_read` names a channel of a configured but disabled server that is in no list
- **THEN** the call fails with `not_readable`, not `guild_not_enabled`

#### Scenario: Channel of a server the bot is not in
- **WHEN** `discord_read` names a channel id of a server the bot has not joined and that is in no list
- **THEN** the call fails with `not_readable`

#### Scenario: Unlisted send target of a disabled server
- **WHEN** `discord_send` names a channel of a disabled server that is not in `agentTools.send.channels`
- **THEN** the call fails with `not_sendable` before any confirmation

### Requirement: Gateway-bound sessions read only their own server
A gateway-bound session SHALL read, search and list only its own server: the one server of all its bindings, or of its spawn reference after the binding closed. Another, several, unresolvable or DM servers (a DM binding is never ignored) SHALL fail with `cross_guild_denied`, an unknown session with `unknown_session`. A channel admitted only by `agentTools.read.guilds` SHALL be readable by a bound session only when `@everyone` can view it.

#### Scenario: Attached session reads another server
- **WHEN** a session attached in server X calls `discord_read` on a readable channel of server Y
- **THEN** the call fails with `cross_guild_denied`

#### Scenario: Spawned session reads another server
- **WHEN** a session the gateway spawned in server X calls `discord_search` with `server` naming server Y
- **THEN** the call fails with `cross_guild_denied`

#### Scenario: Bound session reads its own server
- **WHEN** a session bound in server X calls `discord_read` on a readable channel of server X
- **THEN** the read succeeds

#### Scenario: Unscoped search stays in the own server
- **WHEN** a bound session in server X calls `discord_search` with neither `server` nor `channel`
- **THEN** only readable channels of server X are searched

#### Scenario: Listings name only the own server
- **WHEN** a bound session in server X calls `discord_servers` while servers X and Y are both readable
- **THEN** only server X is listed

#### Scenario: Spawned session whose binding closed
- **GIVEN** a gateway-spawned session counts as bound after its binding closed, its own server then being that of its spawn reference's channel
- **WHEN** a gateway-spawned session in server X has its binding closed and then reads a channel of server Y
- **THEN** the call fails with `cross_guild_denied`

#### Scenario: Attached session whose binding closed
- **WHEN** a session that was attached in server X has had its binding closed and reads a readable channel of server Y
- **THEN** the read succeeds, the session being an ordinary unbound dashboard session

#### Scenario: Own server cannot be resolved
- **WHEN** a bound session's channel cannot be resolved to a server
- **THEN** the read fails with `cross_guild_denied` and nothing is read

#### Scenario: Bindings in two servers
- **WHEN** a session has bindings in servers X and Y and calls `discord_read`
- **THEN** the call fails with `cross_guild_denied`

#### Scenario: Direct-message binding
- **WHEN** a session bound only in a direct message calls `discord_search`
- **THEN** the call fails with `cross_guild_denied`

#### Scenario: Unknown session
- **WHEN** the host cannot find the requesting session
- **THEN** the call fails with `unknown_session` and nothing is read

#### Scenario: Server binding plus direct-message binding
- **WHEN** a session bound in server X and also in a direct message calls `discord_read` on a readable channel of server X
- **THEN** the call fails with `cross_guild_denied` and nothing is read

#### Scenario: Bound session sees no direct-message users
- **WHEN** a session bound in server X calls `discord_servers` while users are listed in `agentTools.send.users`
- **THEN** only server X is listed and no direct-message user

#### Scenario: Whole server listed to a bound session
- **WHEN** a bound session lists a server that is in `agentTools.read.guilds` and has a staff-only channel `@everyone` cannot view
- **THEN** the staff-only channel is not listed and not readable, unless its id is in `agentTools.read.channels`

#### Scenario: Unbound dashboard session
- **WHEN** a session with no gateway binding reads readable channels of servers X and Y
- **THEN** both reads succeed

### Requirement: Private threads are not inherited by bound sessions
For a gateway-bound session a private thread SHALL be readable and listed only when its own id is in `agentTools.read.channels`; it SHALL NOT inherit admission from its parent channel or from `agentTools.read.guilds`.

#### Scenario: Private thread under a listed server
- **WHEN** a bound session in server X reads a private thread whose parent channel `@everyone` can view, X is in `agentTools.read.guilds` and the thread id is in no read list
- **THEN** the call fails with `not_readable` and the thread is not listed

#### Scenario: Private thread listed by id
- **WHEN** a bound session in server X reads a private thread whose own id is in `agentTools.read.channels`
- **THEN** the read succeeds

### Requirement: Reads use the message index when it covers the channel
`discord_read` and `discord_search` SHALL be served from the message index when it covers the channel, otherwise from live history. Each message and channel SHALL report its source, an index read its `coverageFrom`, and the result `complete` (AND of channels). A read or scan reaching `coverageFrom` SHALL continue live. Every loop SHALL stop at the reply size cap, the request deadline and the lane's own 15 s timeout, which no setting (including `0`) lifts.

#### Scenario: Indexed channel
- **WHEN** `discord_search` covers a channel that the server's message index includes
- **THEN** its matches come from the index and report source `index`, without attachments and with an author name only if resolvable

#### Scenario: Coverage unknown
- **WHEN** the index cannot state from when a channel is covered
- **THEN** the channel is read live and is not reported complete from the index

#### Scenario: Cursor older than the index
- **WHEN** `discord_read` is given a `before` message older than the channel's `coverageFrom`
- **THEN** the remainder is read live and those messages report source `live`

#### Scenario: Mixed scope search
- **WHEN** a search covers one indexed and one non-indexed channel
- **THEN** each match reports its own source, the result lists a source per channel, and `complete` is true only if both are complete

#### Scenario: Live scan bound reached
- **WHEN** `limits.agentToolSearchScan` is 500 and a live search scans 500 messages without exhausting history
- **THEN** the result reports source `live` and `complete: false`

#### Scenario: Scan stops at exactly the cap
- **WHEN** `limits.agentToolSearchScan` is 500 and the channel holds exactly 500 messages
- **THEN** the result reports `complete: false`, because exhaustion is not proven without a further fetch

#### Scenario: Unlimited read
- **WHEN** `limits.agentToolReadMessages` is `0` and a channel holds 300 messages
- **THEN** `discord_read` returns all 300, stopping early and reporting `truncated: true` only if the reply would exceed the lane size cap

#### Scenario: Request bound wins over setting
- **WHEN** `discord_read` is called with `limit` 10 while `limits.agentToolReadMessages` is 50, or with `limit` 100 while it is 50
- **THEN** at most 10, respectively 50, messages are returned, and with the setting at `0` the parameter alone applies

#### Scenario: Search trims the oldest matches
- **WHEN** a search's matches exceed the reply size cap
- **THEN** the lowest-ranked, oldest matches are dropped, `truncated` is true and the order reported is newest-first

#### Scenario: Deadline stops a scan
- **WHEN** a live scan exceeds `limits.agentToolRequestDeadlineMs`
- **THEN** it returns the matches found with `complete: false` and `truncated: true`

#### Scenario: Unlimited scan stops after the lane timeout
- **WHEN** `limits.agentToolRequestDeadlineMs` and `limits.agentToolSearchScan` are `0` and a live search with no matches is still paging history 15 seconds after it arrived
- **THEN** the handler stops fetching, so no scan outlives its abandoned reply

### Requirement: Listings report truncation
`discord_servers` and `discord_channels` cut by `limits.listRows` SHALL return `truncated: true` and the count of omitted rows; a listing that fits SHALL return `truncated: false`.

#### Scenario: Channel listing cut by the row limit
- **WHEN** 60 channels are readable and `limits.listRows` is 25
- **THEN** `discord_channels` returns 25 rows, `truncated: true` and 35 omitted

#### Scenario: Unlimited listing
- **WHEN** `limits.listRows` is `0` and 60 channels are readable
- **THEN** all 60 are listed with `truncated: false`

### Requirement: Discord failures are reported by code only
A failed Discord call SHALL return `discord_error:<code>` with Discord's numeric API code and nothing else. HTTP 429 surviving discord.js's own retry SHALL be `discord_error:429` and a failure with no status `discord_error:unreachable`. A failed send SHALL be logged `refused` and consume its chain; a call that no longer reaches a server the bot has left SHALL return the code Discord gives.

#### Scenario: Discord rate-limits a send
- **WHEN** a confirmed send fails with HTTP 429 after discord.js's own retry
- **THEN** the call fails with `discord_error:429`, one `refused` entry records it and the preview is consumed

#### Scenario: Network failure on a read
- **WHEN** a live read fails with a network error that carries no status
- **THEN** the call fails with `discord_error:unreachable`

#### Scenario: Bot removed from an enabled server
- **WHEN** the bot was removed from an enabled server and a session reads or sends there
- **THEN** the call fails with `discord_error:<code>` from Discord, `discord_servers` omits the server and the surface shows the problem `guild_not_present`

### Requirement: Outages fail a call whole
A read or search that loses the adapter mid-scan, or whose later page fails, SHALL fail whole with `discord_unavailable` or `discord_error:<code>` and return nothing. A send whose adapter is disconnected after its preview SHALL fail `discord_unavailable`, consume its preview and append one `refused` entry.

#### Scenario: Adapter drops mid-scan
- **WHEN** the adapter disconnects while `discord_search` fetches its second page
- **THEN** the call fails with `discord_unavailable` and returns no partial matches

#### Scenario: Later page fails
- **WHEN** the first page of a live read succeeds and the second fails with 50013
- **THEN** the call fails with `discord_error:50013` and returns no messages

#### Scenario: Adapter drops after the preview
- **WHEN** the adapter disconnects between a send's preview and its confirmation and the user then confirms
- **THEN** the send fails with `discord_unavailable`, nothing is sent, one `refused` entry is written and the same preview id then fails `bad_request`

### Requirement: Tool parameters have a closed domain
A request `limit` SHALL be an integer of at least 1, else `bad_request`; unlimited is expressed only by the setting. `discord_search` SHALL fail `bad_request` for an empty, whitespace or absent `query` and for a `server` and `channel` that do not belong together; every id SHALL be a digit string, a JSON number is `bad_request`.

#### Scenario: Limit zero is rejected
- **WHEN** `discord_read` is called with `limit` 0, -1, 1.5 or `"10"`
- **THEN** the call fails with `bad_request` and nothing is read

#### Scenario: Empty search query
- **WHEN** `discord_search` is called with an empty, whitespace-only or absent `query`
- **THEN** the call fails with `bad_request` and nothing is scanned

#### Scenario: Server and channel mismatch
- **WHEN** `discord_search` names a `server` and a `channel` that is not in that server
- **THEN** the call fails with `bad_request`

#### Scenario: Id given as a number
- **WHEN** a request names a channel as the JSON number `1234567890123456789`
- **THEN** the call fails with `bad_request`, with no float coercion

### Requirement: Read results are untrusted external content
Every agent read and listing tool SHALL be declared untrusted to the untrusted-content guard registry, and its result SHALL declare itself untrusted and begin with a fixed notice that the content is external data, not instructions. `discord_send`, and any later chat-gateway tool that confirms itself, SHALL be declared self-confirming.

#### Scenario: Read taints the run
- **WHEN** the untrusted-content guard is installed and the agent calls `discord_read` and then a sensitive tool in the same run
- **THEN** the sensitive tool requires confirmation

#### Scenario: Result is self-declared
- **WHEN** `discord_search` returns matches
- **THEN** the result details carry `untrusted: true`

### Requirement: Tools declare accurate annotations
The four read and listing tools SHALL declare `readOnlyHint: true`; `discord_send` SHALL declare `readOnlyHint: false` and `destructiveHint: false`; all SHALL declare `openWorldHint: true`. Later chat-gateway tools SHALL declare their own accurately.

#### Scenario: Reads are not gated as destructive
- **WHEN** a generic approval hook inspects `discord_read`
- **THEN** its annotations mark it read-only

### Requirement: Sends go only to allowlisted targets
`discord_send` SHALL send only to a channel in `agentTools.send.channels` whose server is enabled, or as a DM to a user in `agentTools.send.users`; a thread needs its own id listed and a DM channel id is never sendable. Other targets SHALL fail with `not_sendable` or `guild_not_enabled`. A live global or server disarm, or an unreadable disarm state, SHALL refuse the send with `disarmed`.

#### Scenario: Unlisted channel
- **WHEN** the agent sends to a channel of an enabled server that is not in `agentTools.send.channels`
- **THEN** nothing is sent and the call fails with `not_sendable` before any confirmation

#### Scenario: Allowlisted user
- **WHEN** the agent sends to a user listed in `agentTools.send.users` and the user confirms
- **THEN** the text arrives as a direct message to that user

#### Scenario: Direct-message channel id listed
- **WHEN** a direct-message channel id is in `agentTools.send.channels` and the agent sends to it
- **THEN** the call fails with `not_sendable`

#### Scenario: Listed thread
- **WHEN** a thread's own id is in `agentTools.send.channels` and the agent sends to it and the user confirms
- **THEN** the message is sent to the thread

#### Scenario: Thread of a listed channel
- **WHEN** a channel is in `agentTools.send.channels`, its thread id is not, and the agent sends to the thread
- **THEN** nothing is sent and the call fails with `not_sendable` before any confirmation

#### Scenario: Send is not confined to the bound session's server
- **WHEN** a session attached in server X proposes a send to an allowlisted channel of server Y and the user confirms
- **THEN** the message is sent, and the confirmation named server Y, the channel and the full text

#### Scenario: Direct message needs no shared enabled server
- **WHEN** the agent sends to a user in `agentTools.send.users` who shares no enabled server with the bot, and the user confirms
- **THEN** the send is attempted as a direct message and, if Discord refuses it, fails with `discord_error:<code>`

#### Scenario: Server disarmed
- **WHEN** the target channel's server is disarmed
- **THEN** the call fails with `disarmed` and nothing is sent

#### Scenario: Disarm state unreadable
- **WHEN** the team layer is not configured and the global disarm state cannot be read
- **THEN** the send fails with `disarmed` and nothing is sent

### Requirement: A disarmed own server stops a session's agent tools
The disarm brake SHALL cover agent tools: while any server in which a session is gateway-bound (all its bindings, or its spawn reference's) is disarmed, or the global latch is on, that session's reads, listings and sends SHALL fail with `disarmed`, whatever the target, unless the scope check already fails a read `cross_guild_denied`. This SHALL NOT confine sends to the own server.

#### Scenario: Own server disarmed stops a send elsewhere
- **WHEN** a session bound in server X proposes a send to an allowlisted channel of server Y and server X is disarmed
- **THEN** the call fails with `disarmed` and nothing is sent

#### Scenario: Own server disarmed stops a direct message
- **WHEN** a session bound in server X proposes a send to an allowlisted user and server X is disarmed
- **THEN** the call fails with `disarmed`

#### Scenario: Own server disarmed stops reads
- **WHEN** a session bound in server X calls `discord_read` on a readable channel of X and X is disarmed
- **THEN** the call fails with `disarmed`

#### Scenario: Scope wins over disarm for a two-server session
- **WHEN** a session bound in servers X and Y reads a readable channel of X while Y is disarmed
- **THEN** the call fails with `cross_guild_denied` and nothing is read

#### Scenario: Other server disarmed does not stop an unrelated session
- **WHEN** server Y is disarmed and a session bound in server X sends to an allowlisted channel of server X and the user confirms
- **THEN** the message is sent

### Requirement: Every send is confirmed with its full text and target
`discord_send` SHALL first ask through `ctx.ui.confirm`, with the agent-tool marker, showing the resolved target with ids and the full text in a code block, control and bidi characters made visible. With no UI it SHALL fail `blocked`; a denial, dismissal or timeout SHALL fail `denied` and send nothing. Empty text, or text over Discord's 2000-character limit, SHALL be refused before the confirmation.

#### Scenario: Denied send
- **WHEN** the user denies the confirmation
- **THEN** no message is sent and the tool reports `denied`

#### Scenario: Headless send blocked
- **WHEN** `discord_send` is called in a session without an interactive UI
- **THEN** the call fails with `blocked` and nothing is sent

#### Scenario: Overlong text
- **WHEN** the text is 2001 characters long
- **THEN** the call fails with `message_too_long` and no confirmation is shown

#### Scenario: Length counts UTF-16 code units
- **WHEN** the text is 1001 emoji (2002 UTF-16 code units)
- **THEN** the call fails with `message_too_long` and no confirmation is shown, while 1000 emoji reach the confirmation

#### Scenario: Empty text
- **WHEN** the text is empty or only whitespace
- **THEN** the call fails with `empty_message`, no preview is requested and no confirmation is shown

#### Scenario: Allowlist changed while confirming
- **WHEN** the target is removed from the send allowlist after the confirmation opened and the user then confirms
- **THEN** nothing is sent and the call fails with `not_sendable`

#### Scenario: Send outlives the lane timeout
- **WHEN** the lane times out while `discord/send` is still posting
- **THEN** the bridge reports `timeout` with a notice that the message may have been posted, and does not retry

#### Scenario: Control characters are visible
- **WHEN** the text contains a right-to-left override character
- **THEN** the confirmation shows it as a visible escape inside the code block

### Requirement: Confirmation shows hostile text and labels safely
The confirmation SHALL fence the text with more backticks than its longest backtick run and SHALL show every `\p{Cf}` and `\p{Cc}` character except newline and tab as `\u{XXXX}`, in the text and in every target label (channel, server, user name); newlines in a label SHALL be escaped.

#### Scenario: Fence in the text cannot close the code block
- **WHEN** the text contains a line of three backticks followed by a forged `Target:` line
- **THEN** the confirmation fences the text with a longer fence, so the forged line stays inside the text

#### Scenario: Arabic letter mark is visible
- **WHEN** the text contains U+061C or U+2060
- **THEN** the confirmation shows each as a `\u{XXXX}` escape

#### Scenario: Label with a newline
- **WHEN** a channel name contains a newline, a right-to-left override and backticks
- **THEN** the confirmation shows the label on one line with the newline and the override escaped

### Requirement: A send uses its server-issued preview
The server SHALL issue a preview id with each successful send preview. `discord/send` SHALL send the previewed target and text, accept the id once, and only from the session that obtained it; an unknown, used or foreign id SHALL fail with `bad_request` and send nothing.

#### Scenario: Send needs its preview
- **WHEN** `discord/send` carries an unknown or already used preview id, or another session's
- **THEN** nothing is sent and the call fails with `bad_request`

### Requirement: Agent-tool confirmations are never rendered in Discord
This capability SHALL own the one marker `pluginMeta` `{ pluginId: "chat-gateway", kind: "agent-tool-confirm" }`, the constant `AGENT_TOOL_CONFIRM_META`, used by every chat-gateway tool that confirms; a prompt carrying it is answered on the dashboard or terminal only.

#### Scenario: Send confirmation carries the marker
- **WHEN** `discord_send` asks for confirmation
- **THEN** the prompt's `metadata.plugin` has `pluginId: "chat-gateway"` and `kind: "agent-tool-confirm"`

#### Scenario: Informational tool name is not matched
- **WHEN** the marker also carries `tool: "discord_send"`
- **THEN** the gateway matches on `pluginId` and `kind` only

#### Scenario: Marker is defined once
- **WHEN** a later chat-gateway tool needs a non-chat confirmation
- **THEN** it passes `AGENT_TOOL_CONFIRM_META` and defines no marker of its own

### Requirement: A dropped marker cannot expose a confirmation
Independently of the marker, the gateway SHALL render no prompt whose title starts with a prefix of `AGENT_TOOL_CONFIRM_TITLE_PREFIXES` (`Discord send:`; later tools append theirs), no prompt of a session with a pending entry (one per preview id, kept until its send, its cancel, the session end or the registrant's lifetime; sends use `limits.agentToolConfirmPendingS`, `0` = no expiry), and no prompt it skipped before, until that prompt resolves or the session ends.

#### Scenario: Marker dropped
- **WHEN** the bridge drops the `pluginMeta` of a send confirmation and the session is attached to a Discord channel
- **THEN** the gateway still posts no control for it because the session has a pending confirmation

#### Scenario: Target server stops being enabled while confirming
- **WHEN** the server of a previewed send's target is disabled or becomes unavailable while the confirmation is open and the user then confirms
- **THEN** the pending entry stays until that send, nothing is sent, the call fails with `guild_not_enabled` and one `agent_send` entry records it

#### Scenario: Pending entry clears
- **WHEN** the send, the cancel or the session end arrives and no other entry of the session remains
- **THEN** the session's later prompts render in Discord as usual

#### Scenario: Two confirmations open at once
- **WHEN** a session has two `discord_send` confirmations open, marker dropped, and the first one is sent or cancelled
- **THEN** the gateway still posts no control for the second one until its own send or cancel

#### Scenario: Replayed confirmation after the mark expired
- **WHEN** the gateway skipped a confirmation, its pending entry then expired or was consumed while the prompt stayed open, and the bridge re-sends that prompt on reconnect
- **THEN** the gateway posts no control for it, and forgets it only when that prompt is dismissed or cancelled

#### Scenario: Preview survives the lapse of its pending entry
- **WHEN** `limits.agentToolConfirmPendingS` is 1, the entry lapses after 2 seconds while the confirmation stays open, and the user then confirms
- **THEN** the send is performed from the stored preview; only the session-wide prompt window ended

#### Scenario: Dashboard restarted while confirming
- **WHEN** the dashboard server restarts while a send confirmation is open on an attached session, and the bridge re-sends that prompt without its marker
- **THEN** the gateway posts no control for it because its title starts with `Discord send:`, and a later confirmation fails `bad_request` with nothing sent

#### Scenario: First arrival after the entry lapsed
- **WHEN** `limits.agentToolConfirmPendingS` is shorter than the PromptBus timeout, the entry lapses, and an unmarked copy of the still-open confirmation reaches the gateway for the first time
- **THEN** the gateway posts no control for it because of its title prefix

#### Scenario: Title prefix without marker or entry
- **WHEN** a bound session raises a prompt titled `Discord send: #general (X)` with no marker and no pending entry
- **THEN** the gateway posts no control for it

#### Scenario: Entry lives as long as its registrant's preview
- **WHEN** a later tool registers an entry with a lifetime longer than `limits.agentToolConfirmPendingS`
- **THEN** the entry stays until that lifetime, its commit or cancel, or the session end

### Requirement: Agent sends never mention
Every message sent by `discord_send` SHALL be posted with mention parsing disabled, so that no user, role, `@everyone` or `@here` is notified.

#### Scenario: Everyone mention in text
- **WHEN** a confirmed send contains `@everyone`
- **THEN** the message is posted with the text unchanged and nobody is notified

### Requirement: Gateway-spawned sessions cannot send
The server SHALL refuse `discord_send` with `spawned_session_denied` for a session the gateway spawned or resumed, recognized by its chat-gateway spawn reference or a binding of source `spawn`, whether or not a tool guard is configured, and a session the host does not know with `unknown_session`. A session bound by attaching carries neither and is not refused on this ground. A possible child of a spawned session is handled by "A possible child of a spawned session is confined".

#### Scenario: Spawned session without a guard
- **WHEN** a session spawned by the gateway with no tool policy configured calls `discord_send`
- **THEN** the call fails with `spawned_session_denied` and nothing is sent

#### Scenario: Spawn binding closed
- **WHEN** a spawned session's binding was closed but the session still runs and calls `discord_send`
- **THEN** the call fails with `spawned_session_denied`

#### Scenario: Resumed session
- **WHEN** a session the gateway resumed calls `discord_send`
- **THEN** the call fails with `spawned_session_denied`

#### Scenario: Malformed spawn reference
- **WHEN** a session's `pluginRefs["chat-gateway"]` is an object without a usable `chatSpawnToken` and it calls `discord_send`
- **THEN** the call fails with `spawned_session_denied`, any such object counting as a spawn reference

#### Scenario: Unknown session sends
- **WHEN** the host cannot find the requesting session
- **THEN** the call fails with `unknown_session` and nothing is sent

### Requirement: A possible child of a spawned session is confined
A session with no binding and no spawn reference SHALL be resolved through its parent chain to the nearest bound ancestor when the host exposes one; an unresolvable chain SHALL fail `cross_guild_denied`. Otherwise, while a gateway-spawned session with the same `cwd` is live, it SHALL read only that session's server (another or several: `cross_guild_denied`) and SHALL NOT send (`spawned_session_denied`). Attached sessions SHALL NOT start this rule.

#### Scenario: Child reads another server
- **WHEN** a session with no binding starts in the `cwd` of a live session spawned in server X and calls `discord_read` on a readable channel of server Y
- **THEN** the call fails with `cross_guild_denied`

#### Scenario: Child reads the spawned session's server
- **WHEN** that session reads a readable channel of server X
- **THEN** the read succeeds

#### Scenario: Child sends
- **WHEN** that session calls `discord_send`
- **THEN** the call fails with `spawned_session_denied` and nothing is sent

#### Scenario: Spawned session in several servers
- **WHEN** live spawned sessions of that `cwd` are bound in servers X and Y and the session reads
- **THEN** the call fails with `cross_guild_denied`

#### Scenario: Spawned session ended
- **WHEN** no gateway-spawned session of that `cwd` is live
- **THEN** the session is an ordinary unbound dashboard session

#### Scenario: Attached session does not confine
- **WHEN** a session is only attached (not spawned) in the same `cwd`
- **THEN** a session with no binding there is an ordinary unbound session

#### Scenario: Same directory spelled differently
- **WHEN** a session's `cwd` differs from a live spawned session's only by a trailing slash, a symlink, or letter case on macOS or Windows
- **THEN** the sessions count as the same `cwd` (compared after `path.resolve` and realpath, case-folded on darwin and win32)

#### Scenario: Parent chain resolves
- **WHEN** the host exposes a parent link and the parent is bound in server X
- **THEN** the child is confined to server X and cannot send, whatever its `cwd`

#### Scenario: Parent chain unresolvable
- **WHEN** a session names a parent the host cannot resolve
- **THEN** its reads fail with `cross_guild_denied`

### Requirement: Agent sends are audited
Every send chain SHALL append one command-log entry with principal `session:<sessionId>`, verb `agent_send`, the target channel (empty when none), server and user ids, the outcome and the refusal reason: a server refusal, a performed send, or a user denial or no-UI block (`user_denied`, `blocked`). A Discord failure after the `permitted` entry adds one `refused` entry with `discord_error:<code>`. Entries SHALL NOT contain the message text.

#### Scenario: Permitted send
- **WHEN** a confirmed send to an allowlisted channel succeeds
- **THEN** one entry records the session, `agent_send`, the channel and server, and outcome `permitted`, without the text

#### Scenario: Refused send
- **WHEN** a send is refused with `spawned_session_denied`
- **THEN** one entry records the attempt with that reason

#### Scenario: User denies the confirmation
- **WHEN** the user denies the confirmation of a previewed send
- **THEN** one entry records `agent_send`, outcome `refused` and reason `user_denied`, without the text

#### Scenario: Cancel after the feature was switched off
- **WHEN** the operator disables agent tools while a confirmation is open and the user then denies it
- **THEN** the pending entry is cleared and one entry records `agent_send`, outcome `refused` and reason `user_denied`

#### Scenario: Discord rejects the send
- **WHEN** Discord answers a confirmed send with Missing Permissions (50013)
- **THEN** the `permitted` entry written before the call is followed by one `refused` entry with reason `discord_error:50013`

#### Scenario: Unknown preview id is logged
- **WHEN** `discord/send` carries an unknown, consumed or foreign preview id
- **THEN** it fails `bad_request`, sends nothing and one `refused` entry with reason `bad_request` records it

### Requirement: A send needs its audit trail
A confirmed send SHALL write its `permitted` entry durably before Discord is called; if the write fails the send SHALL NOT be posted and fails `audit_unavailable`, consuming its preview. A failed append to the read-audit ring SHALL NOT refuse the read and SHALL raise a server problem counter.

#### Scenario: Audit write fails
- **WHEN** the command-log append fails with EACCES while a confirmed send is being performed
- **THEN** nothing is posted and the call fails with `audit_unavailable`

#### Scenario: Read-audit ring write fails
- **WHEN** `agentTools.auditReads` is `true` and the read-ring append fails
- **THEN** the read is served and the server problem counter `read_audit_failed` increases

### Requirement: Agent reads are audited only when opted in
While `agentTools.auditReads` (default `false`) is `false`, reads write no audit entry. While `true`, every read or listing request past the `agent_tools_disabled` check SHALL append one entry to a separate read-audit ring, never the command log: principal `session:<sessionId>`, verb `agent_read`, tool, ids (empty when none), outcome and reason, and never content, search terms or results.

#### Scenario: Default does not log reads
- **WHEN** `agentTools.auditReads` is absent and a session calls `discord_read` successfully
- **THEN** no audit entry is written for it

#### Scenario: Opted-in read is logged without content
- **WHEN** `agentTools.auditReads` is `true` and a session calls `discord_search` with query `deploy`
- **THEN** one entry records the session, `agent_read`, the tool, the scope and the outcome, and contains neither `deploy` nor any result text

#### Scenario: Opted-in refusal is logged
- **WHEN** `agentTools.auditReads` is `true` and a read is refused with `cross_guild_denied`
- **THEN** one entry records the attempt with that reason

#### Scenario: Reads cannot evict send evidence
- **WHEN** `agentTools.auditReads` is `true` and reads exceed the read-audit ring size
- **THEN** only read entries are evicted and every `agent_send` entry remains in the command log

### Requirement: Agent tool limits are settings
Agent-tool limits SHALL be settings where `0` means unlimited. Defaults live in code and no save SHALL write them into the stored config.

#### Scenario: Defaults are documented
- **WHEN** no `limits.agentTool*` key is set
- **THEN** these defaults apply: `limits.agentToolReadsPerMinute` 60, `agentToolSendsPerMinute` 5, `agentToolReadsPerSessionPerMinute` 30, `agentToolSendsPerSessionPerMinute` 3, `agentToolReadMessages` 50, `agentToolSearchScan` 500, `agentToolResults` 25, `agentToolRequestDeadlineMs` 12000, `agentToolConfirmPendingS` 600, `agentToolLogSuppressS` 5 and `agentToolReadLogEntries` 10000. and `0` for any of them means unlimited

#### Scenario: A save never materialises agent-tool defaults
- **WHEN** an unrelated setting is saved while the stored `limits` and `agentTools` hold no agent-tool key
- **THEN** the stored config gains no `limits.agentTool*`, `limits.guardReadyS` or `agentTools` key

#### Scenario: Clearing a limit input removes the key
- **WHEN** the operator empties an agent-tool limit input in settings and saves
- **THEN** the key is removed so its default applies, the placeholder shows the default, and `0` is stored only when typed

### Requirement: Long durations are clamped, not rejected
A millisecond or second setting above Node's timer maximum (2147483647 ms) SHALL be clamped to it at runtime with the stored value kept, never rejected and never read as unlimited; the settings hint says so.

#### Scenario: Huge readiness timeout
- **WHEN** `limits.guardReadyS` is 3000000
- **THEN** the timer is armed for 2147483647 ms, so the spawn does not refuse at once, and the stored value stays 3000000

#### Scenario: Huge request deadline
- **WHEN** `limits.agentToolRequestDeadlineMs` is 9007199254740991
- **THEN** the effective deadline is the lane's 15 seconds, with no timer overflow

### Requirement: Rate limits count every request
Every request that passes the session check SHALL count toward the rate limits, including refused probes, and a call over a limit SHALL fail with `rate_limited`. A send chain (preview, then its send or cancel) SHALL count once, at its preview; the send and the cancel SHALL NOT be counted or refused for rate.

#### Scenario: Send rate exceeded
- **WHEN** `limits.agentToolSendsPerMinute` is 5 and a sixth send chain starts within 60 seconds
- **THEN** its preview fails with `rate_limited` before any confirmation and nothing is sent

#### Scenario: Confirmed send is not rate-refused
- **WHEN** a chain's preview was counted and the user confirms while the window is full
- **THEN** the send is not refused for rate and the cancel of another chain is never refused for rate

#### Scenario: Unlimited sends
- **WHEN** `limits.agentToolSendsPerMinute` and `limits.agentToolSendsPerSessionPerMinute` are `0`
- **THEN** no send is refused for rate

#### Scenario: One session cannot exhaust the others
- **WHEN** one session reaches `limits.agentToolSendsPerSessionPerMinute` while the gateway-wide limit is not reached
- **THEN** that session's next send fails with `rate_limited` and another session's send is not refused for rate

#### Scenario: Probes are counted
- **WHEN** a session repeatedly names unlisted channels in `discord_read`
- **THEN** the calls count toward the read limits and fail with `rate_limited` once over them

#### Scenario: Reply at the window edge
- **WHEN** the limit is 5, five requests were counted at t=0 and a sixth arrives at exactly 60.000 s
- **THEN** it is admitted, because the window is half-open (now-60 s, now]

#### Scenario: Lowered limit applies to the current window
- **WHEN** a window holds 3 entries and the operator lowers the limit to 1
- **THEN** the next request is `rate_limited` at once, and a server restart empties every window

### Requirement: Agent tool settings apply without a restart
The operator SHALL edit `agentTools` and the agent-tool limits from the dashboard settings through a validated write that takes effect without a restart. The write SHALL be validated as a whole before anything is applied; an invalid write SHALL be rejected with a reason and SHALL leave the effective settings unchanged. The write SHALL change only the agent-tool keys: other `limits` keys SHALL keep their values.

#### Scenario: Enable from the dashboard
- **WHEN** the operator enables agent tools in settings
- **THEN** the server enforces the new setting at once and sessions pick the tools up at their next status refresh, as the settings hint states

#### Scenario: Invalid id rejected
- **WHEN** a write lists `abc` in `agentTools.send.users`
- **THEN** the write is rejected with `invalid_agent_tools` naming the field path and the previous settings stay in effect

#### Scenario: Each id list has its own cap
- **WHEN** `limits.maxMappings` is 500 and a write lists 500 ids in each of the four lists, then 501 in one
- **THEN** the first write is accepted and the second fails `too_many_mappings`

#### Scenario: Partly invalid write changes nothing
- **WHEN** a write carries a valid `agentTools.send.channels` list and an invalid `limits.agentToolResults` of `-1`
- **THEN** the whole write is rejected with `invalid_limit` and neither the list nor any limit changes

#### Scenario: Stale tab cannot restore a revoked target
- **WHEN** tab A removes a channel from `agentTools.send.channels` and saves, and tab B, loaded earlier, then saves an unrelated agent-tool change
- **THEN** tab B's write fails `revision_changed`, nothing is persisted and the channel stays removed

#### Scenario: Agent-tool limit write keeps other limits
- **WHEN** the operator changes `limits.agentToolSendsPerMinute` while `limits.maxGuilds` and `limits.listRows` have non-default values
- **THEN** after the write `limits.maxGuilds` and `limits.listRows` still have those values

### Requirement: Agent tool writes carry the settings revision
The agent-tool write SHALL require `expectedRevision`, the surface revision that already covers `agentTools` and the agent-tool `limits`: absent SHALL fail `revision_required` and stale `revision_changed`, and nothing SHALL be persisted either way.

#### Scenario: Write without a revision
- **WHEN** a dashboard write of `agentTools` carries no `expectedRevision`
- **THEN** it fails `revision_required` and the settings are unchanged
