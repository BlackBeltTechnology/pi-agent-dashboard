## ADDED Requirements

### Requirement: Read commands are answered in both modes
In an enabled server of either mode the gateway SHALL answer the closed-grammar whole-message commands `!sessions`, `!status`, `!show`, `!search` and `!ask`, never delivering them to a bound session as prompts; other text keeps the mode's normal handling. In an `interactive` server `!search` and `!ask` SHALL be recognised only where no binding resolves. In a `query` server any other `!` command, except `!disarm`, admin commands and later capabilities' commands, SHALL get `Refused: query_mode.`

#### Scenario: Observer searches
- **WHEN** a principal holding `observe` in a `query` server sends `!search deploy failed`
- **THEN** the bot replies in place with matching indexed messages and starts no session

#### Scenario: Read command in an interactive server
- **WHEN** a principal holding `observe` sends the whole message `!status` in a bound channel of an `interactive` server
- **THEN** the bot answers in place and nothing is sent to the bound session

#### Scenario: Untiered user is refused
- **WHEN** an allowlisted user with no server-scoped tier sends `!status` in an unbound channel
- **THEN** the bot replies with the refusal reason and the command log records it

#### Scenario: Stranger gets no reply to a read command
- **WHEN** a user not on the server's allowlist sends `!search deploy` in an opted-in channel of an enabled `query` server
- **THEN** the message is dropped silently and no search runs

#### Scenario: Interactive command still refused
- **WHEN** a principal sends `!attach 1` in a `query` server
- **THEN** the bot replies `Refused: query_mode.` and nothing is attached

#### Scenario: Disarmed server refuses reads
- **WHEN** a server is disarmed and a principal sends `!search x`
- **THEN** the command is refused with `disarmed`

#### Scenario: Steer text starting with a command word still steers
- **WHEN** a user sends `!search the logs for the error` into an attached thread of an `interactive` server
- **THEN** the text is delivered to the session as a steer and no search runs

#### Scenario: Free-text command in a kept-binding channel of a query server
- **WHEN** a server with bound channels is switched to `query` and a permitted principal sends `!search deploy` in a channel that still holds a binding
- **THEN** the bot answers the search from the index and does not reply `Refused: query_mode.`

#### Scenario: Free-text command in an unbound channel
- **WHEN** a permitted principal sends `!ask why did the deploy fail` in an unbound handled channel of an `interactive` server
- **THEN** the bot treats it as the `!ask` command and starts no session

### Requirement: Command grammar is closed
Each command SHALL match its grammar exactly after trimming, tolerating whitespace after the `!`; a non-match SHALL fall through to the mode's normal handling. A session reference SHALL be a positive integer or a hex id prefix of at least 8 characters and a `!show` turn count a positive integer after it, so one-word steer text is not swallowed. The disarm command SHALL never match here nor count toward the rate limit.

#### Scenario: One-word steer after a command word
- **WHEN** a user sends `!status failing` into an attached thread of an `interactive` server
- **THEN** the text is delivered to the session as a steer and no status is answered

#### Scenario: Show with a word instead of a reference
- **WHEN** a user sends `!show it` into a bound channel of an `interactive` server
- **THEN** the text is a prompt and no transcript is read

#### Scenario: Spaced disarm is not a read command
- **WHEN** a user holding `observe` sends `! disarm` in an opted-in channel of an enabled server
- **THEN** A's disarm latch handles it before any command here, and it is neither rate limited nor refused

#### Scenario: Spaced command word
- **WHEN** a permitted principal sends `! status` in an unbound channel
- **THEN** it is answered as `!status`

#### Scenario: Show with a reference and turn count
- **WHEN** a permitted principal sends `!show 2 3` after listing sessions
- **THEN** the bot shows the last three text turns of the second listed session, within the server's cap

#### Scenario: All-digit reference
- **WHEN** a caller listed three sessions and sends `!status 2`, and another caller with no listing sends `!status 99999999`
- **THEN** `2` is the second listed session; `99999999` is looked up as an id prefix and, matching none, is refused `session_not_found`

#### Scenario: Command words are case-insensitive
- **WHEN** a permitted principal sends `!STATUS`, `!Show 1` or `!status DEADBEEF`
- **THEN** each is answered as the lower-case command and the hex reference is lower-cased before matching

#### Scenario: Search without terms falls through
- **WHEN** a user sends a bare `!search` or only `!search in:#ops` into an attached thread of an `interactive` server
- **THEN** the grammar does not match, the text is delivered as a steer and no search runs

### Requirement: Commands in a direct message
A command sent in a direct message has no server. `!search`, `!ask` and the admin commands SHALL NOT be answered there and SHALL be dropped silently, counted as `guild_not_enabled`. `!sessions`, `!status` and `!show` SHALL keep binding-only authorization there and be refused `unbound_channel`. A direct message SHALL NOT use any server's `query.workspaces`.

#### Scenario: Search in a direct message
- **WHEN** a paired user sends `!search deploy` to the bot in a direct message
- **THEN** no search runs, no reply is posted and the drop is counted as `guild_not_enabled`

#### Scenario: Admin command in a direct message
- **WHEN** a user sends `!config show` in a direct message
- **THEN** nothing is answered and no server's configuration is read

#### Scenario: Session command in a direct message
- **WHEN** a user sends `!status` in a direct message
- **THEN** the bot replies `Refused: unbound_channel.` and lists no session

### Requirement: Session reads are scoped
A bound channel of an `interactive` server SHALL keep the bound-workspace scope and the binding's tier. Any other channel, including every `query`-server channel, SHALL use the server's tier and see only live sessions under `query.workspaces` (workspace ids resolved live, default none; an unresolvable or folderless one adds nothing). `!status` and `!show` SHALL never fall back to `allowedRoots`. `!show` SHALL return at most `query.showTurns` turns (default 5, `0` = all).

#### Scenario: No workspaces configured
- **WHEN** `query.workspaces` is empty and a permitted principal sends `!sessions` in an unbound channel
- **THEN** the bot replies that no sessions are in scope

#### Scenario: Show a session's recent turns
- **WHEN** a permitted principal sends `!show 1` after their own `!sessions` listed a session in a configured workspace
- **THEN** the bot posts that session's last text turns without tool output

#### Scenario: Session outside the server's workspaces
- **WHEN** `!show` names a session whose cwd is outside every workspace in `query.workspaces`
- **THEN** no content is posted

#### Scenario: Interactive scope is unchanged
- **WHEN** `!status` is sent in a workspace channel of an `interactive` server
- **THEN** it lists only sessions in that channel's bound workspace

#### Scenario: Unbound channel of an interactive server
- **WHEN** a server principal sends `!sessions` in an unbound handled channel of an `interactive` server with no `query.workspaces`
- **THEN** no session under `allowedRoots` is listed

#### Scenario: Server principal without binding grant in a bound channel
- **WHEN** a principal mapped only on the server record sends `!show 1` in a bound workspace channel where they hold no binding tier
- **THEN** the request is refused and no transcript text is posted

#### Scenario: Show uses the caller's own listing
- **WHEN** another member runs `!sessions` after the caller did, and the caller sends `!show 1`
- **THEN** the session shown is the first of the caller's own listing

#### Scenario: Caller turn count does not raise the cap
- **WHEN** `query.showTurns` is 5 and a principal sends `!show 1 9`
- **THEN** at most 5 turns are shown

#### Scenario: Caller turn count under the cap
- **WHEN** `query.showTurns` is 5 and a principal sends `!show 1 2`
- **THEN** 2 turns are shown

#### Scenario: Unlimited cap with a caller count
- **WHEN** `query.showTurns` is `0` and a principal sends `!show 1 3`
- **THEN** 3 turns are shown, and `!show 1` shows every retained text turn

#### Scenario: Session verb in a kept-binding channel of a query server
- **WHEN** a server principal sends `!sessions` in a channel of a `query` server that still holds a binding
- **THEN** the request is authorized through the server and lists only sessions under `query.workspaces`, not the bound workspace

#### Scenario: Unknown workspace id
- **WHEN** `query.workspaces` holds an id no dashboard workspace has and a principal sends `!sessions` in an unbound channel
- **THEN** that entry contributes no session, no session under `allowedRoots` is listed, and the server row shows `query_workspace_unresolved`

#### Scenario: Workspace without folders
- **WHEN** `query.workspaces` names a workspace that has no folders and a principal sends `!show` with an id prefix of a live session under `allowedRoots`
- **THEN** no transcript text is posted

#### Scenario: Bound workspace without folders
- **WHEN** a channel is bound to a workspace that has no folders and a principal sends `!show` with an id prefix of a live session under `allowedRoots`
- **THEN** no transcript text is posted

#### Scenario: Workspace folders change after configuration
- **WHEN** a folder is added to a workspace named in `query.workspaces` after the config was saved
- **THEN** the next request sees sessions under the new folder without a config change

#### Scenario: User turns hidden by default
- **WHEN** `query.showUserTurns` is absent and a principal sends `!show 1` for a session with user and assistant turns
- **THEN** only assistant text turns are shown

#### Scenario: User turns shown on opt-in
- **WHEN** `query.showUserTurns` is `true` and a principal sends `!show 1`
- **THEN** user and assistant text turns are shown

#### Scenario: Transcript not held
- **WHEN** `!show` names a live session for which the host holds no events
- **THEN** the bot replies `transcript_unavailable`

#### Scenario: Reference that cannot be resolved
- **WHEN** a principal sends `!show 99` after a listing of two sessions, before any listing, after the listed session ended, or for a session outside the scope
- **THEN** the bot replies `Refused: session_not_found.` in each case, so an out-of-scope session is indistinguishable from a missing one, and posts no content

#### Scenario: Ambiguous id prefix
- **WHEN** two in-scope sessions share the id prefix a principal sends in `!show`
- **THEN** the bot replies `Refused: ambiguous_reference.` and posts no content

#### Scenario: Listing map is bounded
- **WHEN** `limits.listingMaxEntries` is 500 and a 501st (channel, user) listing is stored, or a listing is older than `limits.listingTtlMinutes` (30)
- **THEN** the oldest listing is evicted or the expired one is dropped, and `!show n` against it is refused `session_not_found`; `0` for either setting means unlimited

### Requirement: Transcript replies are audience-gated
`!show` SHALL show assistant text turns only, plus user turns if `query.showUserTurns` is `true` (default `false`). It SHALL post a transcript only in a channel `@everyone` cannot view; in a channel `@everyone` can view (Read Message History is irrelevant), or one whose audience cannot be resolved, it SHALL be refused `transcript_reply_public` unless `query.transcriptRepliesPublic` is `true` (default `false`).

#### Scenario: Show in a public channel
- **WHEN** a permitted principal sends `!show 1` in a channel `@everyone` can view
- **THEN** the bot replies `Refused: transcript_reply_public.` and posts no transcript text

#### Scenario: Show in a view-only public channel
- **WHEN** `@everyone` has View Channel but not Read Message History in the channel and a permitted principal sends `!show 1`
- **THEN** the bot replies `Refused: transcript_reply_public.`

#### Scenario: Show in a private channel
- **WHEN** a permitted principal sends `!show 1` in a channel `@everyone` cannot view
- **THEN** the bot posts the turns in place

#### Scenario: Public transcripts allowed by the operator
- **WHEN** `query.transcriptRepliesPublic` is `true` and a permitted principal sends `!show 1` in a public channel
- **THEN** the bot posts the turns in place

#### Scenario: Show in a thread
- **WHEN** a permitted principal sends `!show 1` in a private thread under a public channel, and in a thread whose own effective permissions let `@everyone` view it
- **THEN** the first is posted in place and the second is refused `transcript_reply_public`, because a thread is classified on its own effective permissions

### Requirement: Ask is on by default and bounded
`!ask` SHALL be on unless `query.ask` is `false` (`ask_disabled`) and needs tier `control`. It SHALL be refused `index_disabled` with the index off, `ask_model_unset` without `query.askModel`, and `ask_busy` beyond `query.askConcurrency` or `limits.maxAskCalls`. It SHALL score terms by any-match, use at most `query.askContextMessages` and `query.askContextChars`, stop after `query.askTimeoutMs` and cap output at `query.askMaxTokens`. Defaults are 1, 4, 50, 24000, 120000, 1024; `0` = unlimited.

#### Scenario: Ask without matches calls no model
- **WHEN** a permitted principal asks a question no indexed message matches
- **THEN** the bot replies that no indexed messages match and no model call is made

#### Scenario: Natural-language question retrieves context
- **WHEN** an indexed message says "the deploy failed on the migration step" and a principal asks `!ask why did the deploy fail?`
- **THEN** that message is retrieved as context although it does not contain every word of the question

#### Scenario: Ask without a model setting
- **WHEN** `query.askModel` is absent and a permitted principal sends `!ask why did the deploy fail`
- **THEN** the bot replies `Refused: ask_model_unset.` and no model call is made

#### Scenario: Ask switched off
- **WHEN** `query.ask` is `false` and a principal sends `!ask hi`
- **THEN** the bot replies `Refused: ask_disabled.` and no model call is made

#### Scenario: Ask timeout
- **WHEN** the model call has not finished within `query.askTimeoutMs`
- **THEN** the call is aborted and the bot replies `Refused: ask_timeout.`

#### Scenario: Concurrent ask refused
- **WHEN** `query.askConcurrency` is 1 and a second ask arrives while one runs in the same server
- **THEN** the second ask is refused with `ask_busy`

#### Scenario: Default ceiling refuses ask
- **WHEN** the global ceiling is its default `observe` and a principal sends `!ask hi`
- **THEN** the bot replies `Refused: insufficient_tier.` and no model call is made

#### Scenario: Context character bound
- **WHEN** the matches exceed `query.askContextChars`
- **THEN** only the best matches that fit within the bound are sent to the model

#### Scenario: No match fits the character bound
- **WHEN** every matching indexed message is longer than `query.askContextChars`
- **THEN** the bot replies that no indexed messages match and no model call is made

### Requirement: Ask is an in-process model call with no tools
`!ask` SHALL be one completion through the host's in-process model runtime using `query.askModel`. It SHALL start no pi session and give the model no tools; if the runtime or model is unavailable it SHALL be refused `ask_model_unavailable`. A disarm of the server, or the dashboard's global disarm, SHALL abort its in-flight asks (polled every `limits.askDisarmPollMs`, default 1000, `0` = no polling), and no answer SHALL be posted once disarmed.

#### Scenario: Ask starts no session
- **WHEN** an ask is answered
- **THEN** no pi session was spawned, bound, listed or mirrored and the model received no tool definitions

#### Scenario: Model runtime unavailable
- **WHEN** the host has no model runtime or `query.askModel` names an unknown model
- **THEN** the bot replies `Refused: ask_model_unavailable.` and posts no content

#### Scenario: Disarm aborts an ask
- **WHEN** a server is disarmed while one of its asks is in flight
- **THEN** the call is aborted and no answer is posted

#### Scenario: Global disarm aborts an ask
- **WHEN** the dashboard's global disarm-all is set while an ask is in flight in any server
- **THEN** the call is aborted and no answer is posted

#### Scenario: Polling off still blocks the answer
- **WHEN** `limits.askDisarmPollMs` is `0`, the server is disarmed while an ask runs and the model then returns
- **THEN** no answer is posted

#### Scenario: Empty model answer
- **WHEN** the model call returns empty or whitespace-only text
- **THEN** the bot replies `Refused: ask_model_unavailable.`, counts the outcome `failed` and posts no content

### Requirement: Channel content is framed as untrusted data
Indexed messages given to the model SHALL be passed as data, each JSON-encoded inside a delimiter carrying a per-request random nonce, after a system instruction stating that the data is untrusted, carries no instructions, and that the model has no tools. Authors SHALL be passed as opaque user ids, never names.

#### Scenario: Message tries to close the data block
- **WHEN** an indexed message contains a closing data delimiter and an instruction
- **THEN** it is passed JSON-encoded inside the nonce-delimited block and cannot end the block

### Requirement: Bounded, mention-free replies
B replies SHALL suppress mentions and embeds and neutralise masked links in quoted text and model answers. A reply SHALL span at most `query.maxReplyMessages` messages (default 3), each within Discord's 2000-character limit, and mark elision. Lists SHALL hold at most `limits.listRows` (25) rows and `!search` at most `query.searchResults` (10) results with `query.snippetChars` (200) snippets. `0` = unlimited.

#### Scenario: Indexed message mentions everyone
- **WHEN** a `!search` result quotes a message containing `@everyone`
- **THEN** the reply shows the text and notifies nobody

#### Scenario: Long answer is capped
- **WHEN** an answer needs more messages than `query.maxReplyMessages`
- **THEN** the last posted message ends with an explicit marker of what was not shown

#### Scenario: Masked link in an indexed message
- **WHEN** a `!search` result quotes `[official](https://evil.example)`
- **THEN** the reply shows the destination as plain text, not as a clickable masked link

#### Scenario: Reply send fails
- **WHEN** Discord rejects a reply with HTTP 429 or Missing Permissions, or chunk 2 of 3 fails
- **THEN** the command-log entry is unchanged, the `reply_failed` counter increases and the server row shows a problem, nothing is retried beyond discord.js and the remaining chunks are dropped

#### Scenario: Elision markers
- **WHEN** a list has more rows than `limits.listRows` and a snippet is longer than `query.snippetChars`
- **THEN** the list ends with `… (N more not shown)` carrying the exact omitted count and the cut snippet ends with `…`

### Requirement: Search needs the index
`!search` SHALL be refused `index_disabled` while the server's index is off. With the index on it SHALL reply that no indexed messages match when nothing eligible matches, and an `in:` filter naming a channel the requester may not search SHALL get the same reply.

#### Scenario: Search with the index off
- **WHEN** `index.enabled` is `false` and a principal sends `!search deploy`
- **THEN** the bot replies `Refused: index_disabled.`

#### Scenario: Search in an ineligible channel
- **WHEN** a principal sends `!search x in:#ops` for a channel outside the eligible set
- **THEN** the bot replies that no indexed messages match, exactly as for an empty channel

#### Scenario: Substring match
- **WHEN** an indexed message says "start the deploy" and a principal sends `!search ART`
- **THEN** the message is returned, because a term matches as a case-insensitive substring

### Requirement: Per-user command rate limit
Each command this layer handles, including later capabilities', SHALL count toward `query.commandsPerWindow` (default 10) per user and server per sliding `query.rateWindowSec` seconds (default 60), checked before authorization; `0` for either means unlimited. Over it, the gateway SHALL refuse with `command_rate_limited`, reply once per burst, and log one entry per burst (the first refusal after the user was last in-limit).

#### Scenario: Burst over the limit
- **WHEN** a principal sends 12 commands within the window with the default limit
- **THEN** the last two are refused, one `Refused: command_rate_limited.` reply is posted and one `command_rate_limited` entry is logged

#### Scenario: Command spam does not evict an earlier disarm entry
- **WHEN** a disarm entry is logged and a user then sends 500 over-limit commands
- **THEN** the disarm entry is still in the command log

#### Scenario: A new burst after the window clears
- **WHEN** a user is refused in one burst, is later admitted again, and exceeds the limit a second time
- **THEN** a second `command_rate_limited` entry is logged for the second burst

#### Scenario: Admin commands are rate limited too
- **WHEN** an admin sends more `!report` commands than the limit allows
- **THEN** the excess is refused with `command_rate_limited`

#### Scenario: Command at the window edge
- **WHEN** `query.commandsPerWindow` commands were admitted and the next one arrives exactly `query.rateWindowSec` seconds after the oldest of them
- **THEN** it is admitted, because the window is half-open (now − W, now]

### Requirement: Admin chat commands
In an enabled server of either mode, the server's gateway admins SHALL be able to use `!mode interactive|query`, `!bind <#channel>`, `!bind remove <#channel>`, `!config show` and `!report channels|members|activity`. Gateway-admin status SHALL be checked first, then the verb's tier through the server-scoped chokepoint. A non-admin SHALL be refused `not_admin` with one log entry. `!disarm` SHALL keep the semantics of `chat-gateway-guilds`.

#### Scenario: Non-admin tries to change mode
- **WHEN** a `control` principal who is not a gateway admin of the server sends `!mode interactive`
- **THEN** the command is refused with `not_admin` once and the mode is unchanged

#### Scenario: Admin command in an interactive server
- **WHEN** a gateway admin sends `!config show` in a bound channel of an `interactive` server
- **THEN** the bot answers the command and nothing is sent to the bound session

### Requirement: Admin replies are not posted in public channels
`!config show` and `!report` replies SHALL be posted in place only when the invoking channel is not viewable by `@everyone` (Read Message History is irrelevant). In a public channel, or one whose audience cannot be resolved, they SHALL be refused `admin_reply_public` unless the server's `query.adminRepliesPublic` is `true` (default `false`).

#### Scenario: Report asked in a public channel
- **WHEN** a gateway admin sends `!report members` in a channel `@everyone` can read
- **THEN** the bot replies `Refused: admin_reply_public.` and lists no members

#### Scenario: Report in a view-only public channel
- **WHEN** `@everyone` has View Channel but not Read Message History and a gateway admin sends `!config show`
- **THEN** the bot replies `Refused: admin_reply_public.`

#### Scenario: Report in a private admin channel
- **WHEN** a gateway admin sends `!report channels` in a channel `@everyone` cannot read
- **THEN** the bot posts the report in place

### Requirement: Chat configuration writes use the live server write lane
`!mode` and `!bind` SHALL change only that server's `mode` or `channels` through A's `patchGuildFromChat` (same validated queue as the dashboard, no revision), without a restart, and SHALL be audited. They SHALL be refused with A's `not_admin` and `server_not_adopted` (legacy record), `channel_not_in_server`, `last_channel` (removing the final channel), or the lane's reason on a validation failure.

#### Scenario: Admin opts in a channel
- **WHEN** a gateway admin sends `!bind #support` naming a channel of the same server
- **THEN** the channel is added to that server's opted-in channels and the next message there is handled

#### Scenario: Legacy record is not adopted from chat
- **WHEN** a gateway admin sends `!mode query` in a server whose record is still legacy
- **THEN** the command is refused with `server_not_adopted` and configuration is unchanged

#### Scenario: Channel of another server
- **WHEN** a gateway admin sends `!bind` naming a channel in a different server
- **THEN** the command is refused with `channel_not_in_server`

#### Scenario: Last channel cannot be removed from chat
- **WHEN** a gateway admin sends `!bind remove #support` and it is the server's only opted-in channel
- **THEN** the command is refused with `last_channel` and configuration is unchanged

#### Scenario: Bind of an opted-in channel is a no-op
- **WHEN** a gateway admin sends `!bind #support` for a channel already in `channels`, or `!bind remove #other` for one that is not
- **THEN** the bot replies with a one-line no-op, nothing is written and nothing is refused

#### Scenario: Non-text channel
- **WHEN** a gateway admin sends `!bind` naming a category or voice channel of the same server
- **THEN** the command is refused with `channel_not_in_server` and configuration is unchanged

### Requirement: Config show never prints secrets
`!config show` SHALL print a fixed projection of the server's record: enabled, mode, disarm state, opted-in and indexed channels, query and index settings, effective ceiling, and counts of admins, allowlist entries, principals and role mappings. It SHALL NOT print the bot token, pairing codes, user or role ids, tool policy, or another server's settings.

#### Scenario: Config show output
- **WHEN** a gateway admin sends `!config show`
- **THEN** the reply contains the mode and channel list and contains no token, pairing code, or user id

### Requirement: Admin reports
`!report channels` SHALL list the channels the bot can view, marked handled or indexed. `!report members` SHALL list at most `limits.listRows` members, only when `discordIntents.guildMembers` is on, else reply with the approximate count and `members_intent_disabled`. `!report activity [days]` SHALL report index counts per channel and author within `query.activityDays` and `index.retentionDays` (the smaller nonzero; a caller value never lifts it; `0` = unlimited), never command-log contents.

#### Scenario: Members report without the intent
- **WHEN** `discordIntents.guildMembers` is off and a gateway admin sends `!report members` in a private channel
- **THEN** the bot replies with the approximate member count and states that the member list needs the Server Members intent

#### Scenario: Intent on but not granted in the Developer Portal
- **WHEN** `discordIntents.guildMembers` is on, the Portal switch is off, and the plugin starts
- **THEN** the gateway still serves every server without that intent, the surface shows `members_intent_not_granted`, and `!report members` replies `members_intent_not_granted`

#### Scenario: Activity report rows are capped
- **WHEN** an activity report has more authors than `limits.listRows`
- **THEN** only the top `limits.listRows` authors are listed and the elision is marked

#### Scenario: Activity window under both caps
- **WHEN** `query.activityDays` is 7, `index.retentionDays` is 30 and an admin sends `!report activity 3`
- **THEN** the report covers 3 days

#### Scenario: Activity days with unlimited retention
- **WHEN** `index.retentionDays` is `0`, `query.activityDays` is 7 and an admin sends `!report activity 30`
- **THEN** the report covers 7 days

#### Scenario: Activity report omits the command log
- **WHEN** a gateway admin sends `!report activity`
- **THEN** the reply holds no command-log entry or count

#### Scenario: Adapter failure on a report
- **WHEN** the adapter rejects the member or channel read, or the member count is unavailable, for a `!report`
- **THEN** the bot replies `Refused: discord_unavailable.` and posts no partial list

### Requirement: Query and index settings are per server
Each server's `query` and `index` settings SHALL be edited in that server's settings row, validated on the server write lane and applied without a restart. Count, size and duration settings SHALL accept `0` as unlimited. Negative or non-integer values SHALL be rejected on write and replaced by their default at boot. `discordIntents.guildMembers` SHALL take effect after a restart.

#### Scenario: Invalid setting rejected
- **WHEN** a write sets `query.searchResults` to `-1`
- **THEN** the write is rejected with `invalid_query_setting` and nothing is persisted

#### Scenario: A save does not materialise defaults
- **WHEN** an operator saves any setting of a server record or of `limits` that never stored `query`, `index` or the B `limits` keys
- **THEN** the stored configuration gains no `query`, `index` or B `limits` key, and absent keys keep their documented defaults

#### Scenario: Invalid workspace entry rejected
- **WHEN** a write sets `query.workspaces` to an array holding a non-string or an empty string
- **THEN** the write is rejected with `invalid_query_setting` and nothing is persisted

#### Scenario: Unlimited search results
- **WHEN** `query.searchResults` is `0`
- **THEN** `!search` returns every match, bounded only by `query.maxReplyMessages`

#### Scenario: Rate limit switched off
- **WHEN** `query.commandsPerWindow` is `0`
- **THEN** no command of that server is refused `command_rate_limited`

#### Scenario: Invalid stored value at boot
- **WHEN** the persisted `query.searchResults` is `-1`, `query.ask` is `"false"` and `query.foo` is present
- **THEN** each invalid key takes its documented default, the unknown key is ignored and the server keeps serving

#### Scenario: Invalid index value at boot
- **WHEN** a persisted `index.retentionDays` is `-5` and the index directory holds data
- **THEN** the whole `index` is `index_state_unverified`, nothing is captured, the data is kept and the persisted value is unchanged

#### Scenario: Unknown query key rejected
- **WHEN** a write adds `query.foo`
- **THEN** the write is rejected with `invalid_query_setting` and nothing is persisted

#### Scenario: Unknown index key or non-snowflake channel rejected
- **WHEN** a write adds `index.foo` or sets `index.channels` to `["abc"]`
- **THEN** the write is rejected with `invalid_index_setting` and nothing is persisted

### Requirement: Read entries do not evict the forensic trail
When the command log is full, the entry evicted SHALL be the oldest permitted read-class entry (`list_sessions`, `get_transcript`, `search_messages`, `server_config_show`, `server_report`) if one exists, and otherwise the oldest entry. Permitted read commands SHALL therefore never remove a disarm, spawn, send, config, token-spending or refused entry while a read-class entry remains.

#### Scenario: Read traffic fills the log
- **WHEN** the command log holds a disarm entry and is then filled to its limit and beyond with permitted `!search` entries
- **THEN** the disarm entry is still in the log and only older `search_messages` entries were evicted

#### Scenario: Log without read entries
- **WHEN** the command log is full and holds no permitted read-class entry
- **THEN** the oldest entry is evicted as before
