## MODIFIED Requirements

### Requirement: cwd-binding resolver gated by allowedRoots
Resolving the working directory for an unbound channel SHALL follow a precedence chain:
(1) an existing persisted binding, (2) a bound workspace's folders, (3) a fixed channel→cwd
config map, (4) a configured default workspace, (5) an interactive bind (attach to an
existing dashboard session, or spawn in an allowed root). Every resolved `cwd` SHALL be
inside a configured `allowedRoots` whitelist. Containment SHALL be determined by resolving
the **real path** (following symlinks) of the candidate `cwd` and requiring it to be a
path-prefix descendant of an allowed root; `..` traversal and symlink escapes SHALL be
rejected. A `cwd` outside `allowedRoots` SHALL be rejected and SHALL NOT cause a spawn.
`allowedRoots` SHALL be mandatory: if empty, spawn-based binding SHALL be refused with an
operator-facing message.

A workspace binding SHALL NOT widen `allowedRoots`. A folder belonging to a bound workspace
but lying outside `allowedRoots` SHALL be treated as inert — never resolved, never spawned
into — and SHALL be reported as inert on the configuration surface.

#### Scenario: Path outside allowedRoots is rejected
- **WHEN** any binding source resolves a `cwd` that is not within `allowedRoots`
- **THEN** the gateway SHALL reject the binding and SHALL NOT spawn a session
- **AND** it SHALL reply in-channel that the path is not permitted

#### Scenario: Symlink or traversal escape is rejected
- **WHEN** a candidate `cwd` is a symlink or contains `..` whose real path resolves outside every allowed root
- **THEN** the gateway SHALL reject the binding after real-path resolution and SHALL NOT spawn

#### Scenario: Attach to an existing dashboard session
- **WHEN** a user binds a channel by choosing a live session from `GET /api/sessions` whose `cwd` is within `allowedRoots`
- **THEN** the gateway SHALL attach (subscribe + route prompts) to that existing `sessionId` without spawning

#### Scenario: Spawn correlates the new session via a correlation token
- **WHEN** binding spawns via `POST /api/session/spawn { cwd }` (which does not return the id synchronously)
- **THEN** the gateway SHALL correlate the newly registered session using a spawn correlation token (reusing the `automation-run-lifecycle` correlation mechanism), NOT cwd+recency alone, and record its `sessionId`

#### Scenario: Concurrent same-cwd spawns are disambiguated
- **WHEN** two channels bind by spawning in the same allowed root concurrently
- **THEN** each channel SHALL be matched to its own spawned session via the correlation token, never cross-bound

#### Scenario: Workspace folder outside allowedRoots
- **WHEN** a bound workspace contains a folder that is not within `allowedRoots`
- **THEN** that folder SHALL NOT be resolvable and SHALL NOT cause a spawn
- **AND** the configuration surface SHALL show it as inert

#### Scenario: Workspace folder inside allowedRoots
- **WHEN** a bound workspace contains a folder within `allowedRoots` and a channel binds via the workspace source
- **THEN** the binding resolves to that folder under the same containment check as every other source

### Requirement: Interactive prompts rendered natively via PromptBus
The gateway SHALL render a bound session's `prompt_request` (from pi `ask_user` or any
`ctx.ui` dialog method) as native Discord interactive UI and return the user's choice as
`prompt_response`. `select`, `confirm`, `input`, and `editor` SHALL be
supported; `multiselect` and `batch` SHALL be supported via a composition of native
controls. The gateway SHALL acknowledge each Discord interaction within Discord's ~3s
window by **deferring immediately** (deferred update) and then editing the deferred reply
when the session responds. On `prompt_dismiss`/`prompt_cancel` for that prompt, the gateway
SHALL remove or disable the interactive controls.

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

### Requirement: Layered authorization
The gateway SHALL enforce: L1 — only allowlisted platform users (established via a pairing
code or explicit config) may drive any session; L2 — only an admin may create a channel→cwd
binding (binding grants code execution); L4 — direct messages are isolated per user, and
shared group channels are opt-in per configuration. A pairing code SHALL expire after 15
minutes and SHALL lock out after 10 failed attempts. Unauthorized inbound messages SHALL be
ignored or answered with a pairing prompt, never delivered to a session.

In addition, every action-bearing request that passes L1 SHALL be resolved to a tier and
authorized per binding as specified in `chat-gateway-tier-authorization`. That tier layer
SHALL only be able to refuse: it SHALL NOT admit a principal L1 rejected, and SHALL NOT
permit a binding L2 refused.

#### Scenario: Non-allowlisted user is refused
- **WHEN** a message arrives from a user not on the allowlist
- **THEN** the gateway SHALL NOT deliver it to any session

#### Scenario: Non-admin cannot bind
- **WHEN** a non-admin attempts to bind a channel to a cwd
- **THEN** the binding SHALL be refused

#### Scenario: Expired or exhausted pairing code is rejected
- **WHEN** a pairing code is used after 15 minutes, or after 10 failed attempts
- **THEN** the pairing SHALL be refused and the code invalidated

#### Scenario: Allowlisted user with no tier mapping
- **WHEN** an L1-allowlisted user sends an action-bearing message in a bound channel where they hold no tier mapping
- **THEN** the request SHALL be refused by the tier layer and SHALL NOT reach the session

#### Scenario: Tier layer cannot widen L1
- **WHEN** a principal holds a tier mapping for a binding but is not on the L1 allowlist
- **THEN** the request SHALL be refused at L1 and the tier mapping SHALL NOT grant access
