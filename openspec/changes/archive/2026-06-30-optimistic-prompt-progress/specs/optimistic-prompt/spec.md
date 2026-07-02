# optimistic-prompt — delta

This delta reconciles the `optimistic-prompt` capability with the v2 shadow-queue
reality (`mid-turn-prompt-queue`) and re-introduces the optimistic bubble **scoped
to idle sends only**, with a progressing send-state visual. It removes the v1
requirements that assumed an unconditional write colliding with the mid-turn queue.

## MODIFIED Requirements

### Requirement: Pending prompt state
`SessionState` SHALL include a `pendingPrompt` field (`{ text: string; images?: ChatImage[]; status: "sending" | "sent" } | undefined`) that represents a prompt sent by the user to an **idle** session and not yet confirmed by the server. `pendingPrompt` SHALL be written **only when the session is not mid-turn at send time** (a fresh-turn send). Mid-turn sends SHALL NOT set `pendingPrompt`; they are governed by `mid-turn-prompt-queue`.

#### Scenario: Set pending prompt on idle send
- **WHEN** the user sends a prompt while the session is idle (no turn in progress)
- **THEN** `pendingPrompt` SHALL be set with the sent text, any attached images, and `status: "sending"`

#### Scenario: Mid-turn send does not set pending prompt
- **WHEN** the user sends a prompt while the agent is streaming
- **THEN** `pendingPrompt` SHALL NOT be set
- **AND** the send SHALL be handled by `mid-turn-prompt-queue` (queue chip / steer ghost bubble)

#### Scenario: Bridge acknowledges fresh-turn receipt
- **WHEN** the bridge acknowledges a `send_prompt` as a fresh turn (`prompt_received { fresh: true }`)
- **THEN** `pendingPrompt.status` SHALL transition to `"sent"`

#### Scenario: Bridge reports the send raced into mid-turn
- **WHEN** the bridge acknowledges a `send_prompt` as mid-turn (`prompt_received { fresh: false }`), because the agent began a turn in the same tick as the optimistic write
- **THEN** `pendingPrompt` SHALL be cleared
- **AND** the authoritative `queue_update` chip SHALL render the message instead (no double render)

#### Scenario: Clear pending prompt on server confirmation
- **WHEN** a `message_start` event with role "user" is received by the reducer
- **THEN** `pendingPrompt` SHALL be cleared to `undefined`

#### Scenario: Clear pending prompt on agent start
- **WHEN** an `agent_start` event is received by the reducer
- **THEN** `pendingPrompt` SHALL be cleared to `undefined`

### Requirement: Optimistic user card rendering
When `pendingPrompt` exists, the chat view SHALL render an optimistic user message card at the bottom of the message list, sharing **identical bubble geometry** with a normal user card (same alignment, max-width, radius, left-accent border) so that confirmation introduces zero layout shift. The card SHALL render one of two progress states keyed off `pendingPrompt.status`. Because `pendingPrompt` is only written for idle sends, the optimistic card can never co-exist with a mid-turn queue chip; no text-equality suppression against `Session.pendingQueues` is required.

#### Scenario: Sending state appears immediately on idle send
- **WHEN** an idle prompt is sent and `pendingPrompt.status === "sending"`
- **THEN** an optimistic user card SHALL appear at the bottom of the chat with the prompt text
- **AND** SHALL render at reduced opacity with an animated spinner and a "sending" label
- **AND** any progress/sweep animation SHALL be clipped to the bubble bounds (no bleed past the rounded edge)

#### Scenario: Sent state on bridge acknowledgement
- **WHEN** `pendingPrompt.status` transitions to `"sent"`
- **THEN** the card SHALL render at full opacity
- **AND** the spinner SHALL be replaced by a success check icon with a "sent" label
- **AND** the bubble box dimensions and position SHALL be unchanged from the sending state

#### Scenario: Optimistic card shows images
- **WHEN** `pendingPrompt` includes images
- **THEN** the optimistic card SHALL render image attachments the same as a normal user card

#### Scenario: Confirmed — optimistic card replaced by server card with no layout shift
- **WHEN** the server's `message_start` (role: "user") event arrives
- **THEN** `pendingPrompt` SHALL clear and the server-sourced user card SHALL render in identical geometry
- **AND** the transition SHALL not move or resize the bubble (only the status chip fades out)

### Requirement: Input disabled during pending
The command input SHALL be disabled while `pendingPrompt` exists. Because `pendingPrompt` is only set for idle sends, this disables the input during the fresh-turn confirmation window, preventing duplicate sends. (Mid-turn input-enabled behaviour is governed by `mid-turn-prompt-queue`, where `pendingPrompt` is never set.)

#### Scenario: Input disabled after idle send
- **WHEN** the user sends a prompt while the session is idle
- **AND** `pendingPrompt` is set
- **THEN** the text input and send button SHALL be disabled

#### Scenario: Input re-enabled after confirmation
- **WHEN** `pendingPrompt` is cleared (by server event, bridge race-drop, cancellation, or timeout)
- **THEN** the text input and send button SHALL be re-enabled

### Requirement: Cancel pending prompt
The user SHALL be able to cancel a pending prompt, which removes the optimistic card, sends an abort to the bridge, and re-enables the input.

#### Scenario: Cancel via Stop button
- **WHEN** the user clicks the Stop button while `pendingPrompt` exists
- **THEN** `pendingPrompt` SHALL be cleared, the optimistic card SHALL be removed, an `abort` message SHALL be sent to the server, and the input SHALL be re-enabled

#### Scenario: Cancel via Escape key
- **WHEN** the user presses Escape while `pendingPrompt` exists and the input is focused
- **THEN** the same cancel behavior as the Stop button SHALL occur

### Requirement: Pending prompt survives client-side reset and replay
`pendingPrompt` SHALL NOT be cleared by `session_state_reset` or by the full-replay reset branch of `event_replay`. Only reducer event handlers (e.g. user `message_start`, `agent_start`), the bridge race-drop ack, the safety timeout, and explicit user cancel SHALL clear `pendingPrompt`. The `status` field SHALL be carried across reset/replay unchanged.

#### Scenario: session_state_reset preserves pendingPrompt
- **WHEN** the client receives `session_state_reset` for a session whose `SessionState.pendingPrompt` is set
- **THEN** the session's other state SHALL be reset to `createInitialState()`
- **AND** `pendingPrompt` (including its `status`) SHALL be carried over unchanged into the new state

#### Scenario: event_replay full-reset preserves pendingPrompt
- **WHEN** the client receives `event_replay` with `shouldReset === true` for a session whose `SessionState.pendingPrompt` is set
- **THEN** the session's other state SHALL be reset to `createInitialState()` before applying the replayed events
- **AND** `pendingPrompt` SHALL be carried over unchanged, then the replayed events SHALL be reduced on top of it

#### Scenario: Auto-resume of ended session keeps the optimistic bubble visible
- **WHEN** the user sends a prompt to an ended session and the server triggers auto-resume (per `auto-resume-on-prompt`)
- **AND** the bridge re-registers, causing the server to broadcast `session_state_reset` and/or `event_replay`
- **THEN** the optimistic user-message bubble SHALL remain visible across the reset/replay
- **AND** the bubble SHALL only disappear when the bridge emits the corresponding user `message_start` event (or one of the existing clear paths fires)

#### Scenario: Safety timeout still fires after replay
- **WHEN** `pendingPrompt` survives a reset/replay and 30 seconds elapse without confirmation
- **THEN** the existing `usePendingPromptTimeout` safety path SHALL clear `pendingPrompt` and surface the existing error

## REMOVED Requirements

### Requirement: Multiple in-flight pending prompts permitted while streaming
**Reason:** Superseded by idle-scoping. An idle send starts a turn, so a second concurrent send is by definition mid-turn and is handled by `mid-turn-prompt-queue` as a queue entry — never as a second `pendingPrompt`. There is at most one `pendingPrompt` at a time (the single in-flight fresh turn), eliminating the multi-card reconciliation this requirement governed.

**Migration:** Mid-turn concurrent sends render as authoritative queue chips (`mid-turn-prompt-queue` → "Client uses authoritative `pendingQueues`, no optimistic chip"). No client behaviour relies on multiple simultaneous `pendingPrompt` entries after this change.
