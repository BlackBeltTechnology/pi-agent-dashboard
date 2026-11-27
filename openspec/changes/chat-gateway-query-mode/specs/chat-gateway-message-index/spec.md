## ADDED Requirements

### Requirement: Per-server opt-in capture
The gateway SHALL capture messages into a local index only for an enabled server whose `index.enabled` is `true` (default `false`), and only from channels in its `index.channels` or public threads under them. Bot, webhook, direct and private-thread messages and any message starting with `!` (any command, however spelled) SHALL NOT be captured. Capture SHALL never reply, act or opt a channel into handling, and SHALL continue while the server is disarmed.

#### Scenario: Index off by default
- **WHEN** a server is enabled without index settings
- **THEN** no message from it is stored

#### Scenario: Indexed channel that is not opted in
- **WHEN** a member posts in a channel listed in `index.channels` but not in the server's `channels`
- **THEN** the message is captured and the bot neither replies nor handles it

#### Scenario: Command text not captured
- **WHEN** a member posts `!search the secret term` in an indexed channel
- **THEN** the message is not captured

#### Scenario: Command with a reason not captured
- **WHEN** a member posts `!mod kick <@u> -- spam` in an indexed channel
- **THEN** the message, including its reason text, is not captured

#### Scenario: Spaced command not captured
- **WHEN** a member posts `! search the secret term` or `! mod kick <@u> -- spam` in an indexed channel
- **THEN** the message is not captured

#### Scenario: Capture continues while disarmed
- **WHEN** the server is disarmed and a member posts in an indexed channel
- **THEN** the message is captured, and `!search` is refused `disarmed`

#### Scenario: Private thread not captured
- **WHEN** a member posts in a private thread under an indexed channel
- **THEN** the message is not captured

#### Scenario: Message without text
- **WHEN** a member posts an image-only message, or a system, join, pin or forwarded message, in an indexed channel
- **THEN** the message is not captured

### Requirement: Index storage is private and atomic
The index SHALL be stored under `~/.pi/dashboard/chat-gateway/index/<guildId>/` as per-day segment files with mode 0600 in a 0700 directory, each written to a temporary file and renamed. Entries SHALL hold a format version, message id, channel, thread, author id, timestamps and text only, never author names. Writes SHALL be batched every `limits.indexFlushMs` (default 5000, `0` = every change) and SHALL go through one serialized writer per server.

#### Scenario: Segment file permissions
- **WHEN** the index flushes a segment
- **THEN** the file is replaced by rename and has mode 0600

#### Scenario: Sweep does not race a flush
- **WHEN** a retention sweep and a flush are due for the same server together
- **THEN** they run one after the other and no entry is lost or resurrected

#### Scenario: No author names stored
- **WHEN** a member with a display name posts in an indexed channel
- **THEN** the stored entry carries the author's id and no name

#### Scenario: Duplicate message id
- **WHEN** the same message id arrives twice (a resume replays it, or a backfill page overlaps live capture)
- **THEN** it is stored once, and the later copy replaces the text only when its edit timestamp is newer

#### Scenario: Unreadable index file
- **WHEN** a segment, `coverage.json` or `backfill.json` is truncated, zero-byte or has an unknown `v`
- **THEN** it is skipped by search and sweep, kept on disk untouched, shown as `index_state_unverified` and never overwritten

### Requirement: Retention and size cap
Entries older than `index.retentionDays` (default 30) SHALL be deleted. While a server's index exceeds `index.maxBytes` (default 26214400), its oldest entries SHALL be deleted. `0` SHALL mean unlimited for either. Enforcement SHALL run at start, after each flush, and every `limits.indexSweepMs` (default 86400000, `0` = no timer).

#### Scenario: Retention expiry
- **WHEN** an entry becomes older than `index.retentionDays`
- **THEN** it is deleted by the next sweep and no longer found by `!search`

#### Scenario: Size cap exceeded
- **WHEN** a flush brings a server's index above `index.maxBytes`
- **THEN** the oldest entries are deleted until it is within the cap

#### Scenario: Unlimited retention
- **WHEN** `index.retentionDays` is `0`
- **THEN** entries are never deleted for age

#### Scenario: Entry at the retention boundary
- **WHEN** `index.retentionDays` is 30 and entries are aged 29.9 days, exactly 30 days and 30.1 days
- **THEN** only the 30.1-day entry is deleted (an entry is deleted when `now − ts` exceeds the bound), and a day segment file is removed once all its entries expired

#### Scenario: Size cap below one entry
- **WHEN** `index.maxBytes` is smaller than one entry
- **THEN** the size is the sum of the segment file sizes, `coverage.json` and `backfill.json` excluded, and the oldest entries are deleted until the index is empty

### Requirement: Edits and deletes follow Discord
An edit SHALL replace the text of an existing entry and SHALL never insert one; an edit into an excluded form (a command, or a bot, webhook or private-thread message) or with unavailable new text SHALL remove the entry. A deleted or bulk-deleted message, and a deleted channel or thread, SHALL be removed from the index. An edit or delete the gateway did not observe (it was down, or the server or index was off) SHALL stay indexed until retention removes it.

#### Scenario: Message edited
- **WHEN** an indexed message is edited
- **THEN** `!search` matches the new text and not the old

#### Scenario: Edited into a command is removed
- **WHEN** an indexed message is edited to `!mod kick <@u> -- spam`
- **THEN** its entry is removed and the new text is never stored

#### Scenario: Edit of an uncaptured message is ignored
- **WHEN** a message that was never captured (a command, or one from a non-indexed channel) is edited to ordinary text
- **THEN** nothing is inserted into the index

#### Scenario: Delete while disarmed
- **WHEN** the server is disarmed and an indexed message is deleted
- **THEN** its entry is removed

#### Scenario: Delete missed while the gateway was down
- **WHEN** a message is deleted on Discord while the gateway is stopped
- **THEN** its entry remains searchable until retention removes it

#### Scenario: Message deleted
- **WHEN** an indexed message is deleted on Discord
- **THEN** it is removed from the index and never returned again

### Requirement: Index purge
A server's index SHALL be deleted when its record is removed or its `index.enabled` is set to `false`, and at start when the successfully read configuration no longer lists the server or has its index off. An invalid or unreadable record or `index` value at start SHALL NOT purge: data is kept and a problem shown. A channel removed from `index.channels` SHALL lose its entries, backfill marker and coverage record. A disabled server keeps its index subject to retention and answers nothing.

#### Scenario: Server record removed
- **WHEN** the operator removes a server's record
- **THEN** that server's index directory is deleted

#### Scenario: Orphan index at start
- **WHEN** the plugin starts and an index directory belongs to a server with no record
- **THEN** that directory is deleted

#### Scenario: Invalid index key does not purge
- **WHEN** a server's persisted `index` value is malformed, the plugin starts, and its index directory holds data
- **THEN** the directory is kept, nothing is captured for that server, the row shows `index_state_unverified`, and the persisted value is unchanged

#### Scenario: Invalid record does not purge
- **WHEN** a server's persisted record fails validation at start and its index directory holds data
- **THEN** the directory is kept and the row shows `index_state_unverified`

#### Scenario: Unreadable config does not purge
- **WHEN** the guilds configuration cannot be read at start
- **THEN** no index directory is deleted

#### Scenario: Re-added channel is backfilled again
- **WHEN** a channel is removed from `index.channels`, later added again, and backfill is on
- **THEN** its backfill runs again

#### Scenario: Channel removed from the index
- **WHEN** the operator removes a channel from `index.channels`
- **THEN** that channel's entries are deleted and other channels' entries remain

#### Scenario: Non-snowflake entries are left alone at start
- **WHEN** the index root holds a directory `notes`, a regular file `x.json` and a symlink named like a guild id
- **THEN** boot reconciliation considers only real directories named by digits and touches none of those entries

### Requirement: Optional backfill
Backfill SHALL be off by default. When `index.backfill` is on, each newly indexed channel SHALL be fetched back to at most `index.backfillMessages` messages (default 1000, `0` = back to the retention window) using Read Message History, paced by platform rate limits and recorded as done per channel. A missing permission SHALL be reported as a server problem.

#### Scenario: Backfill without permission
- **WHEN** backfill is on and the bot lacks Read Message History in an indexed channel
- **THEN** the server shows `index_backfill_forbidden` and live capture continues

#### Scenario: Restart after backfill
- **WHEN** the plugin restarts after a channel's backfill finished
- **THEN** that channel is not fetched again

#### Scenario: Forbidden channel is retried
- **WHEN** backfill hits a channel where Read Message History is denied
- **THEN** the channel is not marked done, the problem names the channel and the backfill is retried at the next start and when the channel is re-added

### Requirement: Index reads respect visibility and the reply audience
Search and ask SHALL scan only an eligible channel set computed before the scan: channels where the requester has View Channel and Read Message History and that are the invoking channel (or its parent or threads) or readable by `@everyone`. A channel `@everyone` can view but not read the history of SHALL NOT be a source for itself. Unresolvable permissions SHALL exclude the channel, caps SHALL apply after the filter, and audit entries SHALL hold verb and outcome, never text.

#### Scenario: Member cannot view a channel
- **WHEN** a member without access to an indexed private channel runs `!search` on a term found there
- **THEN** no result from that channel is returned

#### Scenario: Private-channel match is not posted in a public channel
- **WHEN** a member who can view private `#ops` runs `!search` in a public channel and a term matches only in `#ops`
- **THEN** no `#ops` text is posted in the public channel

#### Scenario: Public channel without history for everyone
- **WHEN** `@everyone` has View Channel but not Read Message History in a channel and a member runs `!search` there for a term found in that channel
- **THEN** no result from that channel is posted and the reply is the no-match reply

#### Scenario: Match in the invoking private channel
- **WHEN** a member runs `!search` in a private channel and a term matches in that same channel
- **THEN** the match is returned

#### Scenario: Hidden hits do not displace visible ones
- **WHEN** newer matches exist only in an ineligible channel and `query.searchResults` is 3
- **THEN** the three newest eligible matches are returned

#### Scenario: Search is audited without content
- **WHEN** a principal runs `!search`
- **THEN** the command log records `search_messages` and the outcome but not the search terms

### Requirement: Index search can list a channel and report its coverage
Index search SHALL accept an empty term list (every eligible entry of the named channel) and a `before` message id (strictly older entries, newest first), leaving `!search` and `!ask` unchanged. The index SHALL report per channel the earliest time from which it holds every message, or unknown. The persisted capture start SHALL be removed with the channel's purge.

#### Scenario: List a channel before a message
- **WHEN** a search names an indexed eligible channel with no terms and a `before` id
- **THEN** it returns that channel's entries older than the id, newest first, and none from other channels

#### Scenario: Coverage after a sweep
- **WHEN** a retention sweep deletes the oldest segments of a channel
- **THEN** its coverage is the later of its capture start and the start of the oldest retained segment

#### Scenario: Coverage unknown for an older store
- **WHEN** a channel has entries but no persisted capture start
- **THEN** its coverage is unknown, not guessed

#### Scenario: Coverage after downtime
- **WHEN** the plugin starts, or the gateway reconnects after an outage longer than one heartbeat
- **THEN** each indexed channel's coverage `from` becomes the resume time unless a backfill covers the gap

### Requirement: Index state is observable
Each server's settings row SHALL show the index message count, size, oldest entry and problems. Capture, drop, edit, delete, purge, sweep, backfill and flush-failure outcomes SHALL be counted per server and reason. A failing flush SHALL be logged once per failure streak, not per message.

#### Scenario: Flush failure
- **WHEN** segment writes fail repeatedly
- **THEN** one error is logged, the failure counter increases, and the server row shows the problem
