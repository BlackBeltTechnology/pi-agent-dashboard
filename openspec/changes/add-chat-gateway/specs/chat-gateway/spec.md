# chat-gateway — delta

## ADDED Requirements

### Requirement: Headless client — no bridge or server protocol change
The chat gateway SHALL drive dashboard sessions using ONLY the existing browser-protocol
surface: it SHALL send `subscribe`, `send_prompt`, `prompt_response`, and `abort`, and it
SHALL consume `event` / `event_replay`, `prompt_request`, and `prompt_dismiss` /
`prompt_cancel`. The gateway SHALL NOT require any new message type on the bridge or the
dashboard server, and SHALL NOT modify `packages/extension` (bridge) or the session event
protocol.

#### Scenario: Gateway is a second subscriber
- **WHEN** the gateway subscribes to a session that a browser is also viewing
- **THEN** both SHALL receive the same `event` and `prompt_request` messages
- **AND** a `prompt_response` from either SHALL be accepted by the server

#### Scenario: Unconfigured gateway is inert
- **WHEN** no Discord bot token is configured
- **THEN** the gateway SHALL NOT connect to any platform
- **AND** existing dashboard, bridge, and session behavior SHALL be unchanged

### Requirement: Discord platform adapter behind an extensible interface
The gateway SHALL ship a Discord adapter implementing a platform-agnostic adapter
interface with at least `connect`, `disconnect`, `sendMessage(channelId, text) -> messageId`,
`editMessage(channelId, messageId, text)`, `setTyping(channelId, isTyping)`,
`sendInteractive(channelId, prompt)`, and an `onMessage` inbound callback. The adapter
SHALL be the only platform-specific code; routing, binding, and auth SHALL be
platform-agnostic so additional adapters can be added without core rework.

#### Scenario: Discord connects and receives
- **WHEN** a valid Discord bot token is configured and the gateway starts
- **THEN** the Discord adapter SHALL connect and invoke `onMessage` for inbound messages from allowed users

#### Scenario: Adapter carries no hub logic
- **WHEN** the Discord adapter is inspected
- **THEN** it SHALL contain no session spawning, no `pi --mode rpc` subprocess, and no standalone HTTP/WS server — the dashboard is the hub

### Requirement: Sticky channel→session routing
The gateway SHALL maintain a routing table keyed by `(platform, channelId, threadId?)`
mapping to `{ sessionId, cwd, boundBy, source }`. Bindings SHALL be sticky (persist for the
life of the channel/thread) and SHALL survive a gateway restart. Session-boundary
granularity SHALL be per-thread on platforms with threads and per-channel otherwise.

#### Scenario: Second message reuses the bound session
- **WHEN** a second message arrives on an already-bound channel
- **THEN** the gateway SHALL route it to the same `sessionId` via `send_prompt`, not spawn a new session

#### Scenario: Binding survives restart
- **WHEN** the gateway restarts and a message arrives on a previously-bound channel
- **THEN** the persisted binding SHALL be reused (attach or resume), not re-created

#### Scenario: New thread gets its own binding
- **WHEN** a message arrives in a new thread of a bound channel
- **THEN** the gateway SHALL resolve a binding for that thread independently

### Requirement: cwd-binding resolver gated by allowedRoots
Resolving the working directory for an unbound channel SHALL follow a precedence chain:
(1) an existing persisted binding, (2) a fixed channel→cwd config map, (3) a configured
default workspace, (4) an interactive bind (attach to an existing dashboard session, or
spawn in an allowed root). Every resolved `cwd` SHALL be inside a configured
`allowedRoots` whitelist. Containment SHALL be determined by resolving the **real path**
(following symlinks) of the candidate `cwd` and requiring it to be a path-prefix descendant
of an allowed root; `..` traversal and symlink escapes SHALL be rejected. A `cwd` outside
`allowedRoots` SHALL be rejected and SHALL NOT cause a spawn. `allowedRoots` SHALL be
mandatory: if empty, spawn-based binding SHALL be refused with an operator-facing message.

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

### Requirement: Inbound message delivery and outbound streaming
An inbound chat message from an authorized user SHALL be delivered to the bound session as
`send_prompt { text, delivery }`. Delivery mode SHALL default to `followUp` (queue behind
the running turn, never interrupt); a configurable message prefix (default `!`) SHALL force
`steer`. Session output SHALL be streamed back to the origin channel: assistant text SHALL
be rendered via `sendMessage`/`editMessage` with in-place edits **throttled to at most one
edit per ~1000ms** so Discord edit rate limits are never hit (zero 429s), and a typing
indicator SHALL be shown while the agent is working. When a reply reaches Discord's
2000-character limit, the gateway SHALL continue in a **new** message (chunking), editing
the tail chunk as it grows, rather than truncating. A delivery attempt to a session with no
bridge connection SHALL surface an in-channel error, not fail silently.

#### Scenario: Message becomes a prompt
- **WHEN** an authorized user sends a message on a bound channel
- **THEN** the gateway SHALL send `send_prompt` to the bound session

#### Scenario: Streamed reply edits in place
- **WHEN** the session emits assistant text deltas
- **THEN** the gateway SHALL update a single channel message via `editMessage` at most once per ~1000ms rather than posting one message per delta
- **AND** no Discord 429 rate-limit error SHALL occur during a sustained delta burst

#### Scenario: Reply over 2000 chars chunks into a new message
- **WHEN** a streamed reply grows past Discord's 2000-character limit
- **THEN** the gateway SHALL open a new message and continue there, not truncate

#### Scenario: Prefix forces steer
- **WHEN** the agent is mid-stream and an authorized message begins with the steer prefix (`!`)
- **THEN** the gateway SHALL deliver it with `delivery: steer`; otherwise it SHALL use `followUp`

#### Scenario: Disconnected session surfaces an error
- **WHEN** the bound session has no live bridge connection
- **THEN** the gateway SHALL reply in-channel that the session is unreachable

### Requirement: Interactive prompts rendered natively via PromptBus
The gateway SHALL render a bound session's `prompt_request` (from pi `ask_user` or any
`ctx.ui` dialog method) as native Discord interactive UI and return the user's choice as
`prompt_response`. `select`, `confirm`, `input`, and `editor` SHALL be
supported; `multiselect` and `batch` SHALL be supported via a composition of native
controls. The gateway SHALL acknowledge each Discord interaction within Discord's ~3s
window by **deferring immediately** (deferred update) and then editing the deferred reply
when the session responds. On `prompt_dismiss`/`prompt_cancel` for that prompt, the gateway
SHALL remove or disable the interactive controls.

#### Scenario: Select renders as buttons
- **WHEN** a `prompt_request` of type `select` arrives with options
- **THEN** the gateway SHALL present the options as Discord controls and send the chosen value as `prompt_response`

#### Scenario: Answer elsewhere dismisses the chat prompt
- **WHEN** the same prompt is answered on another surface (e.g. the web UI) first
- **THEN** the gateway SHALL receive `prompt_dismiss` and SHALL disable/remove its Discord controls

#### Scenario: Interaction is acknowledged within 3 seconds
- **WHEN** a user activates a Discord control and the session round-trip exceeds 3 seconds
- **THEN** the gateway SHALL have deferred the interaction immediately and SHALL edit the deferred reply on response, with no Discord "interaction failed" error

### Requirement: Layered authorization
The gateway SHALL enforce: L1 — only allowlisted platform users (established via a pairing
code or explicit config) may drive any session; L2 — only an admin may create a channel→cwd
binding (binding grants code execution); L4 — direct messages are isolated per user, and
shared group channels are opt-in per configuration. A pairing code SHALL expire after 15
minutes and SHALL lock out after 10 failed attempts. Unauthorized inbound messages SHALL be
ignored or answered with a pairing prompt, never delivered to a session.

#### Scenario: Non-allowlisted user is refused
- **WHEN** a message arrives from a user not on the allowlist
- **THEN** the gateway SHALL NOT deliver it to any session

#### Scenario: Non-admin cannot bind
- **WHEN** a non-admin attempts to bind a channel to a cwd
- **THEN** the binding SHALL be refused

#### Scenario: Expired or exhausted pairing code is rejected
- **WHEN** a pairing code is used after 15 minutes, or after 10 failed attempts
- **THEN** the pairing SHALL be refused and the code invalidated

### Requirement: Hard in-session tool policy for spawned sessions
For sessions the gateway spawns, it SHALL load a companion in-session `tool_call`
interceptor that enforces a deny-first tool policy by returning `{ block: true }` for
denied tools (real enforcement, not prompt-text advisory). A tool that is neither
hard-allowed nor hard-denied SHALL escalate to an approval prompt delivered over chat via
`ctx.ui.confirm` (PromptBus); the tool SHALL proceed only on approval. If the approval
prompt is not answered before it times out, the gateway SHALL **fail closed** — the tool
SHALL be blocked (denied), never allowed by default. Sessions bound by attaching to a
pre-existing dashboard session (source a) SHALL be treated as owner-trusted and SHALL NOT be
gated.

#### Scenario: Denied tool is blocked
- **WHEN** a chat-driven turn in a spawned session attempts a denied tool
- **THEN** the interceptor SHALL block the tool call before it executes

#### Scenario: Risky tool asks for approval over chat
- **WHEN** a spawned session attempts a tool that requires approval
- **THEN** the user SHALL be prompted in-channel to allow or deny
- **AND** the tool SHALL execute only if the user allows it

#### Scenario: Unanswered approval fails closed
- **WHEN** an approval prompt times out with no answer
- **THEN** the tool SHALL be blocked (denied), not allowed

#### Scenario: Attached session is not gated
- **WHEN** the session was bound via attach-to-existing (source a)
- **THEN** the tool guard SHALL NOT be applied

### Requirement: Configuration surface
The gateway SHALL expose configuration for: the Discord bot token, `allowedRoots`, the
fixed channel→cwd map, the user allowlist and admins, and a read view of current bindings.
Secrets SHALL be stored at rest with restrictive permissions consistent with existing
dashboard credential handling and SHALL NOT appear in logs or API responses.

#### Scenario: Token is not leaked
- **WHEN** the gateway configuration is read back via any surface
- **THEN** the bot token SHALL NOT be returned in plaintext
