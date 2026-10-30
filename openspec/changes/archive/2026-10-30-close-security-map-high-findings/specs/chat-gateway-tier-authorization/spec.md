## MODIFIED Requirements

### Requirement: Verb tiers come from the dashboard's shared effective-tier table
The tier required by a verb SHALL be read from the dashboard's existing table of effective per-verb tiers rather than declared independently. The layer SHALL NOT recompute that derivation locally. A verb absent from the table, or absent from the layer's curated command allowlist, SHALL be refused.

The only exception is a verb with no row in the MCP tool manifest, and therefore none in the shared table. Such a verb SHALL be declared in the layer's own chat-local table, and SHALL also be on the curated allowlist. The chat-local verbs are `disarm` (`observe`), `attach_session` (`observe`: binding a thread to watch a session; every prompt sent into that thread is still authorized as `send_prompt`), `close_session` (`control`: ending or detaching a thread's session) and `prompt_response` (answering a prompt from a chat control; the dashboard's MCP surface does not expose prompt answering, so the manifest and the shared table carry no row for it). The chat-local tier of `prompt_response` SHALL NOT be a literal: it SHALL be read from the dashboard's browser-message tier for `prompt_response` (`WS_MESSAGE_TIERS.prompt_response`), so it tracks that tier (`control` today). A chat-local entry SHALL NOT declare or override the tier of a verb that has a row in the shared table.

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
