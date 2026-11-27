## MODIFIED Requirements

### Requirement: Query-mode servers refuse interactive actions
An enabled `query` server SHALL NOT spawn, resume, attach, prompt, abort, close, answer prompts (other than the confirmation click of a pending moderation request, which `chat-gateway-moderation` defines), open threads, mirror, or provision. Disarm is not an interactive verb and SHALL work in both modes. A whole-message `!` command there, other than the disarm command, the commands `chat-gateway-query-mode` answers and, only where the server's `moderation.allowInQuery` is on, the `!mod` commands, SHALL get the reply `Refused: query_mode.` and, when that reply is posted, one audit entry with that reason. Other text SHALL get no reply. The commands a `query` server answers are specified by `chat-gateway-query-mode` and, for moderation, by `chat-gateway-moderation`.

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

#### Scenario: Moderation command in a query server
- **WHEN** a qualified admin sends `!mod kick <@u> -- spam` in an opted-in channel of an enabled `query` server whose moderation is enabled but whose `moderation.allowInQuery` is not set
- **THEN** the bot replies `Refused: query_mode.`, the command log records the refusal when that reply is posted, and nothing happens in Discord

#### Scenario: Moderation opted in for a query server
- **WHEN** a qualified admin sends `!mod kick <@u> -- spam` in an opted-in channel of an enabled `query` server whose moderation is enabled, allows `member_kick` and has `allowInQuery` on
- **THEN** the command is handled as a moderation command and no `query_mode` refusal is logged

#### Scenario: Invoker confirms in an opted-in query server
- **WHEN** the invoker clicks Yes on a pending moderation confirmation in an enabled `query` server whose `moderation.allowInQuery` is still on
- **THEN** the click is processed as the moderation confirmation, not refused for the server's mode, and any other prompt click there is still refused

#### Scenario: Moderation off in an opted-in query server
- **WHEN** an admin sends `!mod kick <@u> -- spam` in an enabled `query` server with `allowInQuery` on but moderation not enabled
- **THEN** the bot replies `Refused: moderation_disabled.`, not `query_mode`, and nothing happens in Discord
