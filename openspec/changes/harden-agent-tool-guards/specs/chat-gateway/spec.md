## MODIFIED Requirements

### Requirement: Hard in-session tool policy for spawned sessions
For sessions the gateway spawns, it SHALL load a companion in-session `tool_call`
interceptor that enforces a deny-first tool policy by returning `{ block: true }` for
denied tools (real enforcement, not prompt-text advisory). A tool that is neither
hard-allowed nor hard-denied SHALL escalate to an approval prompt delivered over chat via
`ctx.ui.confirm` (PromptBus); the tool SHALL proceed only on approval. If the approval
prompt is not answered before it times out, the gateway SHALL **fail closed** — the tool
SHALL be blocked (denied), never allowed by default. A spawned session whose configured guard has not announced
readiness for that spawn SHALL receive no chat message; readiness counts only when announced
by the session that spawn resolved to. If it does not arrive within the fixed 30 s readiness timeout (an announcement at exactly 30 s is too late),
the gateway SHALL end the session and tell the user it was refused. When the host cannot
deliver the announcement, the gateway SHALL refuse the spawn. Sessions bound by attaching to a
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

#### Scenario: Guard that never loads ends the session
- **WHEN** a spawned session's companion guard does not announce readiness within the timeout
- **THEN** the gateway SHALL end the session, deliver no message to it, and reply that the session was refused

#### Scenario: Triggering message waits for the guard
- **WHEN** a chat message spawns a session and the guard announces readiness
- **THEN** the triggering message SHALL be delivered only after the announcement

#### Scenario: Readiness from another session is ignored
- **WHEN** a session other than the one the spawn resolved to sends a readiness announcement carrying the spawn's token
- **THEN** the gateway SHALL NOT treat the guard as ready and SHALL NOT deliver the message

#### Scenario: Second message while the guard has not announced
- **GIVEN** a spawn on channel C has resolved but its guard has not announced readiness
- **WHEN** another authorised message arrives on C
- **THEN** the gateway SHALL reply that a session is already starting and SHALL NOT queue or deliver that message

#### Scenario: Resume readiness is bound to the resumed spawn
- **WHEN** an ended session is resumed with a guard configured
- **THEN** readiness SHALL count only from the sessionId the resume spawn resolved to, not the ended session's id

#### Scenario: Delivery failure after readiness keeps the binding
- **WHEN** `send_prompt` fails after the guard announced readiness
- **THEN** the gateway SHALL tell the user the message was not delivered and keep the binding, so the next message is delivered through `send_prompt`

#### Scenario: Host without readiness support refuses the spawn
- **GIVEN** a guard is configured and the host plugin context cannot register a handler for plugin messages
- **WHEN** a message would spawn a session
- **THEN** the gateway SHALL refuse the spawn, start no session, and tell the user

#### Scenario: Attached session is not gated
- **WHEN** the session was bound via attach-to-existing (source a)
- **THEN** the tool guard SHALL NOT be applied

### Requirement: Triggering message runs on spawn or resume
When an inbound message causes the gateway to start a new session or resume an ended one,
that message SHALL be delivered as the session's `initialPrompt` (with the steer prefix
stripped), so the user never has to resend it; with a configured guard it SHALL instead be delivered by `send_prompt` once the guard is ready. The gateway SHALL correlate the spawn with
the later session registration only through `pluginRef` keys it owns (`chatSpawnToken`,
`bindSource`) — never through a core-reserved key (`spawnToken`, `source`, …), which the
host strips before notifying the plugin. On resolution (with a guard, on readiness) the gateway SHALL persist the
channel→session binding so the next message reuses it.

#### Scenario: First message runs in the new session
- **WHEN** an authorized message arrives on an unbound channel and the gateway starts a session
- **THEN** the session SHALL receive that message as its initial prompt
- **AND** the gateway SHALL persist the binding once the session registers

#### Scenario: Follow-up does not spawn again
- **WHEN** a second message arrives after the spawned session registered
- **THEN** it SHALL route to the same session via `send_prompt`, not start another session

#### Scenario: Reserved ref keys are not used for correlation
- **WHEN** the host strips core-reserved `pluginRef` keys before notifying the gateway
- **THEN** the gateway SHALL still bind the spawned session via its own `chatSpawnToken`

#### Scenario: With a guard the first message follows readiness
- **GIVEN** a tool policy and guard are configured
- **WHEN** an authorized message starts a session
- **THEN** the gateway SHALL send that message through `send_prompt` after the guard announced readiness, and SHALL NOT pass it as `initialPrompt`
