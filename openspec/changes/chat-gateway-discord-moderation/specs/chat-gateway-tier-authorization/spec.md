## MODIFIED Requirements

### Requirement: Tier resolution from chat identity
Every action-bearing message or interaction SHALL resolve to exactly one tier (`observe`, `control`, `operate`) or to a refusal. Resolution SHALL consider the author's platform identifier first and mapped platform roles second; when both apply, the highest resulting tier wins. Principal entries and role mappings SHALL be scoped to a single binding — a principal mapped for one binding SHALL NOT thereby gain any tier in another. A request with no binding in an enabled server, any request in a `query` server (whose bindings are dormant), and every server-scoped verb (A: disarm; B: `search_messages`, `ask_messages`, `server_config_show`, `server_report`, `server_mode`, `server_bind`; D: the ten `mod_*` moderation verbs), SHALL resolve against that server's own `principals` and `roles`. Server mappings SHALL NOT grant any other tier inside a binding. Disarm in a bound channel SHALL take the higher of the binding and server tier.

#### Scenario: Unlisted user
- **WHEN** an allowlisted user with no matching identifier entry and no mapped role sends an action-bearing message in a bound channel
- **THEN** the request resolves to a refusal and no action is taken

#### Scenario: Identifier and role both grant
- **WHEN** a user is listed at `observe` by identifier and holds a role mapped to `control` on the same binding
- **THEN** the effective tier is `control`

#### Scenario: Principal mapped for a different binding
- **WHEN** a principal mapped at `control` for one binding acts in a different bound channel where they are not mapped
- **THEN** the request resolves to a refusal

#### Scenario: Server mapping grants no binding tier
- **WHEN** a user mapped at `control` on server A's record, but not on a binding in server A, acts in that binding's channel
- **THEN** the request resolves to a refusal

#### Scenario: Server observer disarms inside a binding
- **WHEN** a user mapped at `observe` on server A's record, and not on the binding, issues the disarm command in a bound channel of server A
- **THEN** server A is disarmed

#### Scenario: Server mapping does not cross servers
- **WHEN** a user mapped at `observe` on server A's record makes a server-scoped request in server B
- **THEN** the request resolves to a refusal

#### Scenario: Server verb from a bound channel
- **WHEN** a gateway admin of the server mapped at `observe` on the server's record, but not on the binding, sends `!config show` in that binding's channel of an `interactive` server
- **THEN** the request resolves against the server record and is not refused for tier

#### Scenario: Session verb in a bound channel still needs the binding
- **WHEN** a user mapped only on the server's record sends `!status 1` in a bound channel of an `interactive` server
- **THEN** the request resolves against the binding's tier and is refused

#### Scenario: Moderation verb from a bound channel
- **WHEN** a user mapped explicitly at `operate` on the server's record, but not on the binding, sends a `!mod` command in that binding's channel
- **THEN** the request resolves against the server record and the verb's tier is met

### Requirement: Verb tiers come from the dashboard's shared effective-tier table
The tier required by a verb SHALL be read from the dashboard's existing table of effective per-verb tiers rather than declared independently. The layer SHALL NOT recompute that derivation locally. A verb absent from the table, or absent from the layer's curated command allowlist, SHALL be refused.

The only exception is a verb with no row in the MCP tool manifest, and therefore none in the shared table. Such a verb SHALL be declared in the layer's own chat-local table, and SHALL also be on the curated allowlist. The chat-local verbs are `disarm` (`observe`), `attach_session` (`observe`: binding a thread to watch a session; every prompt sent into that thread is still authorized as `send_prompt`), `close_session` (`control`: ending or detaching a thread's session), `prompt_response` (answering a prompt from a chat control; the dashboard's MCP surface does not expose prompt answering, so the manifest and the shared table carry no row for it), `search_messages` (`observe`), `ask_messages` (`control`), `server_config_show` (`observe`), `server_report` (`observe`), `server_mode` (`control`), `server_bind` (`control`) and the ten moderation verbs `mod_channel_create`, `mod_channel_rename`, `mod_channel_delete`, `mod_role_create`, `mod_role_assign`, `mod_role_remove`, `mod_member_kick`, `mod_member_ban`, `mod_member_unban` and `mod_member_timeout` (each `operate`). The four `server_*` verbs and the ten `mod_*` verbs SHALL additionally require the principal to be a gateway admin of the server the command came from. The chat-local tier of `prompt_response` SHALL NOT be a literal: it SHALL be read from the dashboard's browser-message tier for `prompt_response` (`WS_MESSAGE_TIERS.prompt_response`), so it tracks that tier (`control` today). A chat-local entry SHALL NOT declare or override the tier of a verb that has a row in the shared table.

#### Scenario: Verb tier changes in the shared table
- **WHEN** the dashboard's effective tier for a verb changes
- **THEN** the tier enforced for that verb changes with it, with no separate edit in this layer

#### Scenario: Chat-only verb uses its declared tier
- **WHEN** an `observe` principal issues `!attach`, and later `!close`, in a bound workspace channel
- **THEN** the attach is permitted at `observe`, and the close is refused because `close_session` requires `control`

#### Scenario: Chat-local table cannot override the shared table
- **WHEN** the shared table has a row for a verb
- **THEN** the tier enforced for that verb is the shared table's, never a chat-local declaration

#### Scenario: Verb outside the curated allowlist
- **WHEN** a request names a verb that is not in the layer's command allowlist
- **THEN** the request is refused even if the principal's tier would otherwise permit that verb's tier

#### Scenario: Answering a prompt from chat needs control
- **WHEN** a principal holding `control` answers a pending prompt from a chat control in a bound channel
- **THEN** the request is authorized as `prompt_response` at `control` and the answer is delivered
- **AND** an `observe` principal's answer is refused for insufficient tier

#### Scenario: Prompt answering still resolves a tier when the shared table has no row
- **WHEN** the shared effective-tier table has no row for `prompt_response`
- **THEN** the verb SHALL resolve to the chat-local tier, not to the unknown-tier refusal

#### Scenario: The chat-local prompt_response tier equals the dashboard's message tier
- **WHEN** the chat-local tier of `prompt_response` is resolved
- **THEN** it SHALL equal the dashboard's browser-message tier for `prompt_response`
- **AND** a change of that dashboard tier SHALL change the chat-local tier with no separate edit in this layer

#### Scenario: The chat-local entry and the removal of the shared row ship together
- **WHEN** the shared table has no row for `prompt_response`
- **THEN** the chat-local table SHALL have its entry
- **AND** while the shared table still has a row for `prompt_response` the chat-local table SHALL NOT

#### Scenario: Server admin verb needs admin status and tier
- **WHEN** a gateway admin of a server who resolves to `observe` there sends `!mode query`
- **THEN** the request is refused for insufficient tier because `server_mode` requires `control`

#### Scenario: Moderation verb needs operate
- **WHEN** a gateway admin of a server who resolves to `control` there sends a `!mod` command
- **THEN** the request is refused for insufficient tier because every `mod_*` verb requires `operate`

### Requirement: Configuration is editable only from the dashboard
Principals, role mappings, ceilings, allowlists, admins, mirror levels, query and index settings, limits, moderation settings, and team bindings SHALL be editable only through the dashboard configuration surface, never through a chat message at any tier. The only exceptions SHALL be a server's `mode` and its opted-in channel list, which that server's gateway admins MAY change from chat with `!mode` and `!bind` as specified in `chat-gateway-query-mode`.

#### Scenario: Attempt to change authorization from chat
- **WHEN** any principal, at any tier, sends a command intended to alter principals, tiers, ceiling, or filter settings
- **THEN** the layer refuses and takes no configuration action

#### Scenario: Gateway admin changes the server mode from chat
- **WHEN** a gateway admin of a server holding `control` there sends `!mode query`
- **THEN** only that server's `mode` changes, through the validated server write lane, and the change is audited

#### Scenario: Moderation settings are not editable from chat
- **WHEN** any principal, at any tier, sends a chat message intended to change a server's moderation settings
- **THEN** the layer refuses and takes no configuration action
