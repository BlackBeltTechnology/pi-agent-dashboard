## MODIFIED Requirements

### Requirement: Query-mode servers refuse interactive actions
An enabled `query` server SHALL NOT spawn, resume, attach, prompt, abort, close, answer prompts, open threads, mirror, or provision. Disarm is not an interactive verb and SHALL work in both modes. A whole-message `!` command there, other than the disarm command and the commands `chat-gateway-query-mode` answers, SHALL get the reply `Refused: query_mode.` and, when that reply is posted, one audit entry with that reason. Other text SHALL get no reply. The commands a `query` server answers are specified by `chat-gateway-query-mode`.

#### Scenario: Plain message in a query server
- **WHEN** an allowlisted user posts ordinary text in an opted-in channel of an enabled `query` server
- **THEN** no session is spawned or prompted and the bot does not reply

#### Scenario: Session command in a query server
- **WHEN** an allowlisted user sends `!attach 1` in an opted-in channel of an enabled `query` server
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

#### Scenario: Read command in a query server
- **WHEN** a permitted principal sends `!sessions` in an opted-in channel of an enabled `query` server
- **THEN** the bot answers with the sessions in that server's scope and no `query_mode` refusal is logged

### Requirement: Live server configuration write
Server records SHALL be written through a validated lane as record-level patches carrying the revision the editor saw, serialized with the team-controls lane, and SHALL take effect without a restart. The lane SHALL serve the dashboard and, for one server's `mode` and `channels` only, that server's gateway admins from chat as specified by `chat-gateway-query-mode`; a chat write carries no revision. A rejected or failed write SHALL change nothing and SHALL report a specific reason. A write without a payload SHALL be refused, not read as a reset. A `guilds` value written outside the lane SHALL apply at the next start, dropping only invalid records.

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

#### Scenario: Concurrent chat and dashboard writes
- **WHEN** a dashboard save and a chat `!bind` for the same server arrive together
- **THEN** both are applied one after the other, or the dashboard save is rejected with `revision_changed`, and neither change is lost
