## ADDED Requirements

### Requirement: Per-server configuration record
The gateway SHALL keep one configuration record per Discord server under `guilds.<guildId>` with `enabled`, `mode`, `label`, `admins`, optional `allowlist`, `channels`, `principals`, `roles`, optional `ceiling`, and `provisioning.enabled`. A record without `enabled` SHALL be disabled and a record without `mode` SHALL be `query`. There SHALL be no global mode setting. A channel id SHALL belong to at most one record.

#### Scenario: Record defaults are fail-closed
- **WHEN** an operator saves a record containing only a guild id
- **THEN** that server is disabled and in `query` mode

#### Scenario: Channel listed on two servers
- **WHEN** a write lists the same channel id on two server records
- **THEN** the write is rejected with `channel_in_multiple_guilds` and nothing is persisted

#### Scenario: Non-snowflake id in a list
- **WHEN** a write puts `<@123>` in a server's `admins`, `allowlist` or `channels`
- **THEN** the write is rejected with `invalid_snowflake` and nothing is persisted

#### Scenario: Duplicate channel on boot
- **WHEN** the stored configuration lists one channel id on two server records
- **THEN** that channel id is dropped from both records, every other setting still loads, and each affected server reports a problem

### Requirement: Unconfigured servers are listed but inert
A server the bot is a member of but which has no record SHALL be listed in settings with its live name and id, shown as `query` and disabled. It SHALL receive no inbound handling and no outbound message until an operator enables it. Discovery SHALL NOT write configuration.

#### Scenario: Bot added to a new server
- **WHEN** the bot joins a server the operator has not configured
- **THEN** the server appears in the settings list marked discovered and inert
- **AND** messages in that server are not handled and the bot posts nothing there

#### Scenario: Operator enables a discovered server
- **WHEN** the operator enables a discovered server
- **THEN** a record is written with `enabled: true`, `mode: "query"` and the operator's allowlist choice

### Requirement: Messages from a non-enabled server are dropped
A guild message or interaction SHALL be dropped silently, with no reply and no audit entry, unless its server has a record with `enabled: true`. Direct messages and direct-message interactions SHALL follow the direct-message path and are not subject to this rule. This SHALL hold even if its channel id appears in any channel list. A guild channel SHALL count as opted in only when it or its thread parent is listed in the `channels` of its own server's record. Drops SHALL be counted per reason.

#### Scenario: Opted-in channel id in a disabled server
- **WHEN** a message arrives in a channel listed on a record whose server is disabled
- **THEN** the message is dropped with no reply and the `guild_not_enabled` drop counter increases

#### Scenario: Channel listed under another server
- **WHEN** a message arrives from enabled server A in a channel listed only on server B's record
- **THEN** the message is dropped with no reply

#### Scenario: Direct message is unaffected
- **WHEN** a paired user sends a direct message while no server is enabled
- **THEN** it follows the direct-message path as before

#### Scenario: Prompt answer from a non-enabled server
- **WHEN** a user presses a prompt control in a server that is not enabled
- **THEN** the press is acknowledged without any visible change, nothing is posted or answered, and the `guild_not_enabled` counter increases

#### Scenario: Prompt answer in a direct message
- **WHEN** a user answers a prompt in a direct message
- **THEN** the answer is handled by the direct-message path and is not dropped as a non-enabled server

### Requirement: Outbound only to enabled servers
The gateway SHALL NOT send, edit, type, open or archive a thread, render a control, create or change a channel or its permissions, or provision in a guild whose server is not enabled. Mirroring, thread creation and provisioning SHALL additionally require the server's mode to be `interactive`. Direct messages SHALL be unaffected.

#### Scenario: Server disabled while a session is mirrored
- **WHEN** a server is disabled while a session mirrors into one of its threads
- **THEN** no further message is posted there and the session keeps running

#### Scenario: Thread or channel write in a non-enabled server
- **WHEN** the gateway is asked to open a thread, archive a thread or change a channel in a server that is not enabled
- **THEN** the adapter refuses it with `guild_not_enabled` and nothing changes in that server

#### Scenario: Refused send is not retried
- **WHEN** a mirror or typing send is refused with `guild_not_enabled`
- **THEN** it is not retried, no per-event error is logged, and mirroring state for that channel stops

#### Scenario: Unknown channel or lost access is not retried
- **WHEN** a mirror, stream, typing or prompt send fails with Discord error 10003, 10004 or 50001
- **THEN** it is not retried, one warning is logged for that channel, and mirroring state for that channel stops until the next server or record change

#### Scenario: Pending prompt in a server that stops being interactive
- **WHEN** a gateway session has a pending prompt rendered in a server that is then disabled or switched to `query`
- **THEN** the gateway forgets that prompt and removes its controls best-effort, a later Discord press is ignored, and the session is not sent an answer, so the dashboard can still answer the prompt

#### Scenario: Mirroring resumes after switching back
- **WHEN** an eligible dashboard session is seen while its workspace's server is `query`, and the server is then switched back to `interactive`
- **THEN** the session is mirrored into its workspace channel exactly once, without a restart

### Requirement: Query-mode servers refuse interactive actions
An enabled `query` server SHALL NOT spawn, resume, attach, prompt, abort, close, answer prompts, open threads, mirror, or provision. Disarm is not an interactive verb and SHALL work in both modes. A whole-message `!` command there, other than the disarm command, SHALL get the reply `Refused: query_mode.` and, when that reply is posted, one audit entry with that reason. Other text SHALL get no reply. The commands a `query` server answers are specified by `chat-gateway-query-mode`.

#### Scenario: Plain message in a query server
- **WHEN** an allowlisted user posts ordinary text in an opted-in channel of an enabled `query` server
- **THEN** no session is spawned or prompted and the bot does not reply

#### Scenario: Session command in a query server
- **WHEN** an allowlisted user sends `!sessions` in an opted-in channel of an enabled `query` server
- **THEN** the bot replies `Refused: query_mode.` and the command log records the refusal

#### Scenario: Multi-word bang message in a query server
- **WHEN** an allowlisted user posts `!hello there` in an opted-in channel of an enabled `query` server
- **THEN** the bot replies `Refused: query_mode.` and no session is prompted

#### Scenario: Stranger in a query server
- **WHEN** a user not on the server's allowlist posts `!sessions` or plain text in an opted-in channel of an enabled `query` server
- **THEN** the message is dropped silently and the bot never reveals the server is in `query` mode

#### Scenario: Disarm in a query server
- **WHEN** a user holding at least `observe` for that server sends the disarm command in an opted-in channel of an enabled `query` server
- **THEN** that server is disarmed, no `query_mode` refusal is sent, and other servers are unaffected

#### Scenario: Server switched from interactive to query
- **WHEN** an operator switches a server with bound threads from `interactive` to `query`
- **THEN** mirroring and driving stop in that server, bindings are kept, and switching back resumes them

#### Scenario: Spawn in flight
- **WHEN** a spawn was accepted in an `interactive` server and the server is switched to `query` or disabled before the session is ready
- **THEN** the spawn completes and its binding is stored, nothing is posted to that server after the switch, and no session is killed

### Requirement: Refusals follow L1 and L4
In a guild, the L1 allowlist and L4 opt-in SHALL be checked before the server's mode, so `Refused: query_mode.` is only ever sent to an allowlisted user in an opted-in channel. A whole-message `!` command SHALL be a message whose first non-space character is `!` followed by a word character, meaning an ASCII letter, digit or underscore.

#### Scenario: Space after the bang
- **WHEN** an allowlisted user posts `! hello` in an opted-in channel of an enabled `query` server
- **THEN** it is treated as plain text and gets no reply

#### Scenario: Non-ASCII letter after the bang
- **WHEN** an allowlisted user posts `!état`, `!команда` or a full-width digit after the bang in an opted-in channel of an enabled `query` server
- **THEN** it is treated as plain text and gets no reply

### Requirement: Refusal replies are throttled
Refusal replies in a guild channel SHALL be limited to `limits.refusalRepliesPerMinute` per minute (default 6, `0` unlimited), counted per opted-in channel with a thread counting against its parent. A reply over the limit SHALL be dropped and counted as `refusal_throttled`. A `query_mode` refusal SHALL be audited only when its reply is posted. A non-allowlisted user in an enabled `query` server SHALL get no reply.

#### Scenario: Busy channel does not flood
- **WHEN** ten non-allowlisted users post in an opted-in channel of an enabled `interactive` server within one minute and the limit is 6
- **THEN** at most six refusal replies are posted

#### Scenario: Refusal throttle disabled
- **WHEN** `limits.refusalRepliesPerMinute` is `0`
- **THEN** every refusal is replied to

#### Scenario: Threads share their parent's budget
- **WHEN** one user posts refused commands across ten threads of one opted-in channel within a minute and the limit is 6
- **THEN** at most six refusal replies are posted

#### Scenario: Spam of bang commands does not flood the log
- **WHEN** an allowlisted user posts `!x` fifty times in a minute in an enabled `query` server and the limit is 6
- **THEN** six replies and six audit entries are written and the other forty-four are only counted as `refusal_throttled`

### Requirement: Reserved record keys are preserved
The validator for a server record SHALL accept the reserved keys `query`, `index` and `moderation`, each a plain object, and SHALL store and return them unchanged without interpreting them. Any other unknown record key SHALL be rejected. A reserved key that is not an object, exceeds `limits.maxReservedBytes` (default 262144, `0` unlimited) or contains a prototype key SHALL be rejected on a write and dropped alone on boot. A write SHALL keep every persisted reserved key, even one dropped on boot.

#### Scenario: Rollback keeps servers loadable
- **WHEN** a record written by a later version holds `query`, `index` and `moderation` and the plugin is rolled back to this version
- **THEN** the server stays enabled with the same mode, channels and tiers, and its reserved keys are unchanged after the operator saves another field

#### Scenario: Unknown key rejected
- **WHEN** a write carries a record key that is neither defined nor reserved
- **THEN** the write is rejected with `unknown_guild_key` and nothing is persisted

#### Scenario: Malformed reserved key on boot
- **WHEN** a stored record has a reserved key that is not an object
- **THEN** that key is dropped, the rest of the record loads, and the reserved feature stays off

#### Scenario: Save after a dropped reserved key
- **WHEN** a record's malformed `index` key was dropped on boot and the operator then saves another field of that record
- **THEN** the persisted `index` value is unchanged by the save

#### Scenario: Prototype key inside a reserved object
- **WHEN** a write carries a reserved object containing a `__proto__` key
- **THEN** the write is rejected with `invalid_reserved_key` and nothing is persisted

### Requirement: Per-server admins and allowlist
Bind authority in a server SHALL require the user to be listed in that server's `admins` and to pass L1. A server's `allowlist`, when present, SHALL replace the global allowlist for that server. When it is absent the global allowlist SHALL apply. Discord server ownership or administrator permission SHALL NOT imply gateway admin. Admin status in one server SHALL confer nothing in another.

#### Scenario: Admin of another server tries to bind
- **WHEN** a user listed in server A's `admins` tries to bind a channel in server B where they are not an admin
- **THEN** the binding is refused with `not_admin`

#### Scenario: Server without its own allowlist
- **WHEN** a server record has no `allowlist` and a user paired by DM writes in an opted-in channel
- **THEN** L1 admits the user by the global allowlist

#### Scenario: Enable asks about the allowlist
- **WHEN** the operator enables a discovered server in settings
- **THEN** settings require an explicit choice between inheriting the global allowlist and a server-specific one before the record is written

### Requirement: Enabling a server requires an allowlist choice
A write that enables a server, or creates an enabled record, SHALL carry `allowlist` (even `[]`) or `inheritAllowlist: true`, else it SHALL be rejected with `allowlist_choice_required`. `inheritAllowlist` SHALL NOT be stored, and on an enabled record it SHALL remove the stored `allowlist`. Both together SHALL be rejected with `allowlist_choice_required`. Adopting a legacy record and an edit that leaves the allowlist alone SHALL be exempt.

#### Scenario: Enable without an allowlist choice
- **WHEN** a write enables a disabled or new server record with neither `allowlist` nor `inheritAllowlist: true`
- **THEN** the write is rejected with `allowlist_choice_required` and nothing is persisted

#### Scenario: Enable inheriting the global allowlist
- **WHEN** a write enables a server with `inheritAllowlist: true`
- **THEN** the record is stored enabled with no `allowlist` and `inheritAllowlist` is not stored

#### Scenario: Enabled server switched to inherit
- **WHEN** a write sends `inheritAllowlist: true` for an enabled server that has its own `allowlist`
- **THEN** the stored `allowlist` is removed and the global allowlist applies

#### Scenario: Ambiguous allowlist choice
- **WHEN** a write carries both `allowlist` and `inheritAllowlist: true`
- **THEN** it is rejected with `allowlist_choice_required` and nothing is persisted

### Requirement: Bindings and prompt answers are checked against their server
A message or prompt answer in a bound channel SHALL be refused unless the binding's server equals the server it came from; a binding with no server SHALL be refused. A prompt answer SHALL be authorized against the server the prompt was rendered in, using that server's allowlist and opt-in, and SHALL be ignored when it arrives from a different server.

#### Scenario: Prompt answer from another server
- **WHEN** a prompt rendered in server A is answered from server B
- **THEN** the answer is ignored and the prompt stays pending

#### Scenario: Prompt answer after adoption
- **WHEN** an authorized user answers a prompt in an opted-in channel of an `interactive` server after the legacy keys were adopted
- **THEN** the answer is accepted

#### Scenario: Binding without a server
- **WHEN** a request arrives in a bound channel whose binding has no server id
- **THEN** it is refused and nothing reaches the session

### Requirement: Legacy single-server configuration is normalized at read time
When no server record exists and a legacy key (`groupChannels`, `admins`, `teamControls.guildId`) is non-empty, the gateway SHALL derive in-memory records without writing configuration, even if `guilds` is an empty object. Each server owning a `groupChannels` channel, or named by `teamControls.guildId`, SHALL become an enabled `interactive` record with those channels and the global `admins`. Provisioning SHALL be enabled only for `teamControls.guildId`.

#### Scenario: Unrelated save before first server write
- **WHEN** an upgraded install with legacy keys saves an unrelated setting such as `steerPrefix` before any server write
- **THEN** the legacy channels, admins and provisioning keep working and the next restart still treats the install as legacy

#### Scenario: Upgrade with a single-server config
- **WHEN** an install with `groupChannels`, `admins` and `teamControls.guildId` upgrades
- **THEN** the same channels, admins and provisioning behave as before without any config edit
- **AND** the server is shown in settings marked legacy

### Requirement: Legacy channels resolve before inbound is handled
A legacy server SHALL go live as soon as one of its own channel ids resolves, and a channel whose id is not yet resolved SHALL be dropped. A legacy channel id that cannot be resolved to a server SHALL stay in the legacy keys, be reported and retried, and SHALL NOT be discarded. It SHALL NOT delay any other server, with or without `limits.legacyResolveTimeoutMs`.

#### Scenario: Unresolvable legacy channel
- **WHEN** a legacy channel id cannot be resolved to a server at start
- **THEN** it stays in the legacy keys, the settings list it as unresolved, and it is retried later instead of being discarded

#### Scenario: One unresolvable legacy id does not silence other servers
- **WHEN** two legacy servers' channel ids resolve and a third id never resolves, with `limits.legacyResolveTimeoutMs` set to `0`
- **THEN** both resolved servers handle messages as before and only the unresolved id stays dropped

### Requirement: First server write adopts legacy keys
The first accepted dashboard `upsert` of a server record in legacy mode SHALL, in one configuration update, persist `guilds`, set `guildId` on every team binding, remove `teamControls.guildId`, and empty `groupChannels` and `admins`, keeping the global `allowlist`. It SHALL re-read the live team configuration first, SHALL revert in-memory state if persisting fails, and SHALL be refused with `legacy_unresolved` while a legacy channel id is unresolved unless the operator discards it.

#### Scenario: Adoption on first save
- **WHEN** the operator saves a legacy server's record
- **THEN** `guilds` holds the record, legacy `groupChannels`, `admins` and `teamControls.guildId` are cleared, and bindings carry `guildId`

#### Scenario: Adoption blocked by an unresolved channel
- **WHEN** the operator saves a legacy server's record while one legacy channel id is unresolved
- **THEN** the write is rejected with `legacy_unresolved`, nothing is cleared, and the id can be discarded only by an explicit operator choice

#### Scenario: Concurrent team-panel edit during adoption
- **WHEN** a team-controls edit is saved between building the settings surface and the adoption write
- **THEN** adoption keeps that edit and does not restore the removed legacy server id

#### Scenario: Limits edit in legacy mode does not adopt
- **WHEN** the operator changes only a `limits` key while the gateway is in legacy mode
- **THEN** the limit is stored and no legacy key is cleared

#### Scenario: Chat mode switch in legacy mode
- **WHEN** a legacy server's admin sends `!mode query` from chat
- **THEN** the write is refused with `server_not_adopted` and nothing is persisted or adopted

#### Scenario: Remove in legacy mode
- **WHEN** the operator removes a server while the gateway is in legacy mode
- **THEN** the write is refused with `server_not_adopted` and nothing changes

#### Scenario: Older version after adoption
- **WHEN** the plugin is rolled back to a version without server records after adoption
- **THEN** that version handles no guild message until the operator restores the legacy keys

### Requirement: Live server configuration write
Server records SHALL be written through a dashboard-only validated lane as record-level patches carrying the revision the editor saw, serialized with the team-controls lane, and SHALL take effect without a restart. A rejected or failed write SHALL change nothing and SHALL report a specific reason. A write without a payload SHALL be refused, not read as a reset. A `guilds` value written outside the lane SHALL apply at the next start, dropping only invalid records.

#### Scenario: Enable takes effect immediately
- **WHEN** the operator enables a server and its channel
- **THEN** the next message there is handled without restarting the dashboard

#### Scenario: Stale editor write rejected
- **WHEN** the operator saves from a settings tab whose revision is older than the stored one, for example after a chat `!mode query`
- **THEN** the write is rejected with `revision_changed` and the stored records are unchanged

#### Scenario: Only the named record changes
- **WHEN** a write upserts one server record
- **THEN** every other server record and the reserved keys of the edited record are unchanged

#### Scenario: Out-of-band write with an invalid record
- **WHEN** `guilds` is written outside the lane with one invalid record and the plugin then starts
- **THEN** only that record is dropped, its server reports the problem, and the other servers load

#### Scenario: Empty write refused
- **WHEN** a server-config write carries no payload
- **THEN** it is refused and existing records are unchanged

### Requirement: Limits are settings with an unlimited option
Every count, size or duration limit SHALL be a setting with a documented default, and `0` SHALL mean unlimited. `limits.maxGuilds` (default 0), `limits.maxBindings` (200) and `limits.maxMappings` (500) SHALL bound records, bindings and each id list or map. `limits.maxDiscoveredGuilds` (100) SHALL bound the unconfigured servers listed. A limit write SHALL change only the keys it names. Discord's own message-length limit is a platform fact, not a setting.

#### Scenario: Unlimited mappings
- **WHEN** `limits.maxMappings` is `0` and a server lists 600 role mappings
- **THEN** the write is accepted

#### Scenario: Servers unlimited by default
- **WHEN** `limits.maxGuilds` is unset and a write carries 150 server records
- **THEN** the write is accepted

#### Scenario: Server cap set
- **WHEN** `limits.maxGuilds` is `2` and a write carries 3 server records
- **THEN** the write is rejected with `too_many_guilds`

#### Scenario: Discovered servers list is bounded
- **WHEN** the bot is in 150 unconfigured servers and `limits.maxDiscoveredGuilds` is 100
- **THEN** settings list 100 and report that 50 more are omitted

#### Scenario: Limit write keeps other keys
- **WHEN** a write sets `limits.maxGuilds` while the stored `limits` also holds a key owned by a later change
- **THEN** the other key is unchanged

#### Scenario: Mappings cap set
- **WHEN** `limits.maxMappings` is `3` and a write gives one server 4 `admins`
- **THEN** the write is rejected with `too_many_mappings` and nothing is persisted

#### Scenario: Negative limit rejected
- **WHEN** a write sets a limit to `-1`
- **THEN** it is rejected with `invalid_limit` and nothing is persisted

#### Scenario: Default bound
- **WHEN** `limits.maxBindings` is unset and a write carries 201 bindings
- **THEN** the write is rejected with `too_many_bindings`

### Requirement: Disarm state is per server and persisted
The gateway SHALL keep one disarm latch per server plus one global latch, persisted outside plugin configuration so that it survives a restart. A chat disarm SHALL set only the latch of the server it came from. Only the dashboard disarm lane SHALL clear a server latch, never a team-controls save. A disarm command that arrives without a server, such as in a direct message, SHALL be refused and SHALL NOT change any latch.

#### Scenario: Server latch survives restart
- **WHEN** a server is disarmed from chat and the plugin restarts
- **THEN** that server is still disarmed and other servers are not

#### Scenario: Team-controls save does not re-arm a server
- **WHEN** a server is disarmed from chat and a team-controls save carrying `disarmed: false` is then written
- **THEN** that server is still disarmed

#### Scenario: Disarm from a direct message
- **WHEN** a paired user sends the disarm command in a direct message
- **THEN** it is refused, no server or global latch changes, and the reply points to a server channel

#### Scenario: Prompt answer in a disarmed server
- **WHEN** a user presses a prompt control in a server that is disarmed
- **THEN** the answer is refused and the prompt is not consumed

### Requirement: Disarm state files fail closed
A legacy global latch file SHALL be read as the global latch, never as a re-arm. An existing latch file that cannot be read SHALL latch globally and report a problem. A file whose top-level `disarmed` is true while it names no explicit latch SHALL latch globally. A rolled-back older version SHALL read any live latch as its single global latch.

#### Scenario: Legacy global latch is migrated
- **WHEN** the plugin starts with a latch file written by the previous version holding `disarmed: true`
- **THEN** the global latch is set and stays set until the dashboard re-arms it

#### Scenario: Corrupt latch file
- **WHEN** the plugin starts and the latch file exists but cannot be parsed
- **THEN** the global latch is set, the settings report the problem, and the dashboard can re-arm

#### Scenario: Inconsistent latch file
- **WHEN** the plugin starts and the latch file has `disarmed: true`, `all: false` and no server latch
- **THEN** the global latch is set and stays set until the dashboard re-arms it

#### Scenario: Older version after a server disarm
- **WHEN** a server was disarmed and the plugin is rolled back to a version with one global latch
- **THEN** that version refuses action-bearing requests in every server until the dashboard re-arms

### Requirement: Writes are judged on what they change
A write SHALL be validated strictly for the records it upserts and for what it adds. A channel id added to a record that another record holds SHALL be rejected with `channel_in_multiple_guilds`, naming both servers and the channel. A write adding records SHALL be rejected with `too_many_guilds` when the result exceeds `limits.maxGuilds`. A conflict between untouched records SHALL NOT block an unrelated write, SHALL be reported as a problem, and SHALL be repairable by editing a record.

#### Scenario: Write blocked by a duplicate names both servers
- **WHEN** a write adds a channel id to server A that server B's record already lists
- **THEN** the write is rejected with `channel_in_multiple_guilds`, naming servers A and B and the channel

#### Scenario: Out-of-band duplicate does not block an unrelated write
- **WHEN** two untouched records share a channel id because of an out-of-band write and the operator edits a third record
- **THEN** the edit is accepted and both servers still report the duplicate as a problem

#### Scenario: Write repairs an offending record
- **WHEN** a write removes the shared channel id from one of the two offending records
- **THEN** the write is accepted and the problem clears

### Requirement: Chat-origin writes are narrowed to one server and two fields
A chat-origin config write SHALL use `patchGuildFromChat`, never the dashboard patch. It SHALL change only `mode` or `channels` of the origin server's own record, never another record, `limits`, reserved keys or any other field, and SHALL NOT remove or adopt. It SHALL be refused with `not_admin` unless the sender is in that server's `admins`, and with `server_not_adopted` while the record is only synthesized from legacy keys.

#### Scenario: Chat write cannot touch another server
- **WHEN** an admin of server A sends a chat write naming server B's record or a field other than `mode` and `channels`
- **THEN** the write is refused and no record changes

#### Scenario: Non-admin chat write
- **WHEN** an allowlisted user who is not in the server's `admins` requests a chat write
- **THEN** it is refused with `not_admin`

### Requirement: Reconcile is per binding
Provisioning reconcile SHALL handle each binding on its own. A binding whose server is not enabled, not `interactive`, or without provisioning SHALL be skipped with `provisioning_guild_not_enabled`: no platform call, no rename, no permission change on its existing channel, and it SHALL NOT fail the reconcile. A platform failure on one binding SHALL be recorded for its server and SHALL NOT stop the bindings of other servers, and unbound records SHALL still be deactivated.

#### Scenario: Disabled server does not block another server's binding
- **WHEN** a binding in a disabled or `query` server and a binding in an enabled `interactive` server with provisioning are reconciled together
- **THEN** the second binding is provisioned or converged, the first reports `provisioning_guild_not_enabled`, and no overwrite call is made for the first

#### Scenario: Platform failure in one server
- **WHEN** a platform call fails for a binding in server A while a binding in server B is due
- **THEN** server B's binding still converges and the failure is reported under server A

### Requirement: A provisioned channel stays in its server
A binding whose `guildId` differs from the server stored on its provisioned channel record SHALL be skipped with `binding_guild_changed`: no channel is created, renamed or re-permissioned. A record with no stored server SHALL be back-filled from the channel before comparing; when it cannot be resolved the binding SHALL be skipped with `binding_guild_unverified`. The settings UI SHALL not offer a different server for an already provisioned binding.

#### Scenario: Server changed after provisioning
- **WHEN** an operator changes a provisioned binding's server from A to B
- **THEN** no channel is created or changed in either server and health reports `binding_guild_changed`

### Requirement: Disarm command is matched before the mode gate
The disarm command SHALL be a message whose whole text matches the shipped pattern: optional whitespace, `!`, optional whitespace, `disarm`, optional whitespace, case-insensitive. It SHALL be recognised before the whole-message `!` command rule and before the mode gate, in both modes. A message that merely starts with it SHALL not match.

#### Scenario: Spaced disarm in an interactive server
- **WHEN** a user holding `observe` sends `! disarm` in an opted-in channel of an enabled `interactive` server
- **THEN** that server is disarmed and no session is spawned or prompted

#### Scenario: Spaced disarm in a query server
- **WHEN** a user holding `observe` sends `! disarm` in an opted-in channel of an enabled `query` server
- **THEN** that server is disarmed and no `query_mode` refusal is sent

### Requirement: Session bindings carry their server
A persisted session binding SHALL carry its server id, resolved lazily when it predates this version. Until resolved it SHALL NOT be mirrored or answered, and a direct-message prompt SHALL be answered only from a direct message.

#### Scenario: Binding persisted before the upgrade
- **WHEN** a session binding written before this version has no server id and its server cannot be resolved yet
- **THEN** it is neither mirrored nor given prompt controls, the `binding_guild_unresolved` counter increases, and it is retried when the bot's servers are known

### Requirement: Server patches need a revision and merge by key
A dashboard write to a server record SHALL carry the revision, else it SHALL be rejected `revision_required`. A named record key SHALL replace its stored value whole, and an optional key SHALL be removed only by an explicit `clear`, never by omission.

#### Scenario: Write without a revision
- **WHEN** a dashboard server-config write omits the revision
- **THEN** it is rejected with `revision_required` and nothing is persisted

#### Scenario: Clear an optional key
- **WHEN** a write upserts a record naming `clear: ["ceiling"]`
- **THEN** the stored `ceiling` is removed, every other key of the record is unchanged, and `clear` is not stored

#### Scenario: Clear a key that cannot be cleared
- **WHEN** a write names `mode` or a reserved key in `clear`
- **THEN** it is rejected with `invalid_clear` and nothing is persisted

### Requirement: Pairing codes are bounded by settings
`limits.pairingTtlMinutes` (default 15) and `limits.pairingMaxAttempts` (default 10) SHALL bound a pairing code. `0` SHALL mean the code never expires, or never locks.

#### Scenario: Pairing limits are settings
- **WHEN** `limits.pairingMaxAttempts` is `3` and a pairing code is guessed wrong three times
- **THEN** the code is locked out, and with the value `0` it never locks

### Requirement: Disarm state is readable by other components
The disarm state offered to callers outside the controller SHALL come from the live latches while the gateway runs, so a latch that failed to persist still reads as disarmed.

#### Scenario: Latch not persisted still reads disarmed
- **WHEN** a server is disarmed from chat while the latch file cannot be written, and another component asks for that server's disarm state
- **THEN** the answer is `disarmed`, not `armed`, and the settings report that the latch is not persisted

### Requirement: A malformed server map fails closed
When `guilds` is present but is not an object, every server SHALL be inert, the surface SHALL report `guildsConfigError`, and the legacy keys SHALL be ignored for as long as `guilds` is present and malformed.

#### Scenario: Malformed guilds map
- **WHEN** the stored `guilds` is a string, an array, `null` or a number while `groupChannels` is non-empty
- **THEN** no server handles any message, `guildsConfigError` is set, and the legacy channels are not revived

### Requirement: Refusal throttle uses a sliding window
A refusal reply SHALL be posted when fewer than `limits.refusalRepliesPerMinute` refusal replies were posted in the preceding 60 000 ms, the window being half-open `(now − 60 000 ms, now]`. A refusal reply whose send fails SHALL NOT count as posted: it writes no audit entry, consumes no throttle budget and is not retried.

#### Scenario: Reply at window edge
- **WHEN** the limit is 1 and a second refusal arrives exactly 60 000 ms after the first was posted
- **THEN** the second reply is posted, and a refusal at 59 999 ms is throttled

#### Scenario: Failed refusal send
- **WHEN** a refusal reply fails with a platform error such as 429, 50013 or 50001
- **THEN** no audit entry is written, the throttle budget is unchanged, and the send is not retried

### Requirement: Limit changes apply live except start-time keys
Every `limits` key SHALL apply to the next message or write after a limit write, except `limits.pairingTtlMinutes`, `limits.pairingMaxAttempts` and `limits.legacyResolveTimeoutMs`, which are read at start. A `limits` key named `__proto__`, `constructor` or `prototype` SHALL be rejected `invalid_limit` on a write and dropped on boot. A millisecond or second setting above the Node timer maximum SHALL be clamped to 2147483647 ms at runtime, keeping the stored value.

#### Scenario: Limit applies to the next message
- **WHEN** `limits.refusalRepliesPerMinute` is lowered by a write
- **THEN** the very next refused message is throttled by the new value

#### Scenario: Limit applies to the next write
- **WHEN** `limits.maxMappings` is lowered by a write
- **THEN** the very next write is judged by the new value

#### Scenario: Start-time limit
- **WHEN** `limits.pairingTtlMinutes` is changed while a pairing code is live
- **THEN** the live code keeps its old lifetime and the new value applies after a restart

#### Scenario: Prototype key as a limit
- **WHEN** a write names `__proto__` as a `limits` key
- **THEN** it is rejected with `invalid_limit`, nothing is persisted, and the same key in stored config is dropped on boot

#### Scenario: Oversized timer is clamped
- **WHEN** `limits.legacyResolveTimeoutMs` is set above 2147483647
- **THEN** the write is accepted, the stored value is unchanged, and the timeout runs as 2147483647 ms

### Requirement: Discovered servers are listed in id order
Unconfigured servers SHALL be listed in ascending numeric snowflake order, compared as integers. The first `limits.maxDiscoveredGuilds` SHALL be listed and the rest SHALL be counted in `discoveredOmitted`.

#### Scenario: Discovered list order
- **WHEN** the bot is in 150 unconfigured servers and `limits.maxDiscoveredGuilds` is 100
- **THEN** the 100 numerically smallest ids are listed in ascending order, and 9 sorts before 10

### Requirement: Record values are measured and normalized
The size of a reserved key SHALL be the UTF-8 byte length of its compact JSON. An id list with a repeated id SHALL be stored de-duplicated and counted after de-duplication against `limits.maxMappings`. `label` and the `guilds` object SHALL NOT be bounded by this gateway beyond the host request size.

#### Scenario: Multibyte reserved key
- **WHEN** a write carries a reserved object of 150 000 `é` characters and `limits.maxReservedBytes` is 262144
- **THEN** it is rejected with `invalid_reserved_key`, although its UTF-16 length is below the limit

#### Scenario: Duplicate ids in a list
- **WHEN** a write gives `channels` the same id four times and `limits.maxMappings` is 3
- **THEN** the id is stored once and the write is accepted

### Requirement: Wrong-typed record fields are rejected
A write whose known record field has the wrong type, such as `enabled: "yes"`, `label: 5`, `provisioning: "on"`, a `clear` that is not an array, or an upsert value that is not an object, SHALL be rejected with `invalid_guild_record` naming the field path, and nothing SHALL be persisted.

#### Scenario: Wrong type for a known field
- **WHEN** a write carries `enabled: "yes"`
- **THEN** it is rejected with `invalid_guild_record` naming `enabled` and nothing is persisted

### Requirement: Server ids are validated at every entry
A `teamControls.bindings.<ws>.guildId` that is not a snowflake SHALL be rejected with `invalid_guild_id`. The dashboard disarm lane SHALL reject a missing or non-snowflake `guildId` for `disarm` and `rearm` with `invalid_guild_id`, and SHALL accept any snowflake, including one with no record.

#### Scenario: Bad guild id on a binding
- **WHEN** a team-controls write gives a binding `guildId` of `"abc"`
- **THEN** it is rejected with `invalid_guild_id` and nothing is persisted

#### Scenario: Disarm lane with a bad or unknown id
- **WHEN** the disarm lane gets `rearm` with `guildId` `"abc"`, and then `disarm` for a snowflake that has no record
- **THEN** the first is rejected with `invalid_guild_id` and the second latches that server

### Requirement: Team-controls writes are judged on what they change
A team-controls write, including legacy adoption, SHALL be checked against `limits.maxBindings` and `limits.maxMappings` only for what it adds. An unrelated write SHALL be accepted over a lowered cap, and adding beyond the cap SHALL be rejected `too_many_bindings`.

#### Scenario: Unrelated team write over a lowered cap
- **WHEN** five bindings are stored, `limits.maxBindings` is later set to 1, and a team write changes only a label
- **THEN** it is accepted, and a write that adds a sixth binding is rejected with `too_many_bindings`

### Requirement: A hung configuration write times out
A configuration write SHALL fail with `config_write_timeout` when the host update does not settle within `limits.configWriteTimeoutMs` (default 30000, `0` = no timeout). On timeout the in-memory state SHALL revert and the write queue SHALL continue with the next write.

#### Scenario: Hung write
- **WHEN** the host update never settles and a chat `mode` write is queued behind it
- **THEN** the first write fails with `config_write_timeout` after the timeout, memory reverts, and the queued write then runs

### Requirement: Removing a server keeps references inert
A `remove` of a server record SHALL succeed even while team bindings, session bindings, a provisioned channel, mirrored threads or a disarm latch still reference that server. The references SHALL be kept and fail closed: provisioning skips with `provisioning_guild_not_enabled`, nothing is mirrored, the latch is kept, and the server's message index is purged.

#### Scenario: Remove keeps references inert
- **WHEN** an operator removes a server that a binding, a provisioned channel and a disarm latch still reference
- **THEN** the write succeeds, the references remain, nothing is posted to or changed in that server, and the latch is still set

### Requirement: A cleared limit input removes the key
Clearing a limit input in settings and saving SHALL remove that key from `limits`, so its documented default applies. `0` SHALL be written only when the operator types it.

#### Scenario: Cleared limit input
- **WHEN** the operator empties a limit input and saves
- **THEN** the key is removed from `limits`, the input shows the default as a placeholder, and the effective limit is the default, not unlimited
