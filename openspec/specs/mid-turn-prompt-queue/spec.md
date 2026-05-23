# Mid-turn Prompt Queue

## Purpose

Surface per-session pending-prompt state typed while the agent is mid-turn. Users compose steering and follow-up prompts during streaming; pi's native queues hold them, the bridge mirrors state via shadow queues, the server caches the snapshot from `queue_update` events, and the client renders the `PromptQueuePanel` above the chat input. Steering drains incrementally at `turn_end` boundaries; follow-up drains incrementally at `agent_end` boundaries — both per-entry by user `message_start` matcher.
## Requirements
### Requirement: Typed-during-streaming prompts are forwarded to pi's native queues

When the bridge receives a `send_prompt` message AND `getBridgeState().isAgentStreaming` is `true` for the target session AND the prompt is not a slash, bash, compact, reload, new, model, or mgmt command, the bridge SHALL route the prompt directly to pi's native queue via `pi.sendUserMessage`, governed by `msg.delivery`:

- If `delivery === "followUp"` (or absent — backward compat with PR #27's default rule), the bridge SHALL call `pi.clearFollowUpQueue()` THEN `pi.sendUserMessage(text, { deliverAs: "followUp" })`. The clear-then-send sequence enforces a depth-1 invariant on pi's follow-up queue for dashboard-originated sessions.
- If `delivery === "steer"`, the bridge SHALL call `pi.sendUserMessage(text, { deliverAs: "steer" })` directly. The bridge SHALL NOT clear the steering queue first.

The bridge SHALL NOT maintain its own parallel storage for either case.

#### Scenario: Follow-up send while slot is empty
- **WHEN** the agent is streaming
- **AND** `pendingQueues.followUp` is `[]`
- **AND** the bridge receives `send_prompt { text: "run tests when done", delivery: "followUp" }`
- **THEN** the bridge SHALL call `pi.clearFollowUpQueue()` (no-op on empty queue)
- **AND** the bridge SHALL call `pi.sendUserMessage("run tests when done", { deliverAs: "followUp" })`
- **AND** the next `queue_update` SHALL show `followUp: ["run tests when done"]`

#### Scenario: Follow-up send while slot is occupied replaces the entry
- **WHEN** the agent is streaming
- **AND** `pendingQueues.followUp` is `["original text"]`
- **AND** the bridge receives `send_prompt { text: "replacement", delivery: "followUp" }`
- **THEN** the bridge SHALL call `pi.clearFollowUpQueue()`
- **AND** the bridge SHALL call `pi.sendUserMessage("replacement", { deliverAs: "followUp" })`
- **AND** the next `queue_update` SHALL show `followUp: ["replacement"]` (original lost; replace semantics by design — see design.md Decision 2)

#### Scenario: Steer send appends to pi's steering queue
- **WHEN** the agent is streaming
- **AND** `pendingQueues.steering` is `["earlier steer"]`
- **AND** the bridge receives `send_prompt { text: "new steer", delivery: "steer" }`
- **THEN** the bridge SHALL call `pi.sendUserMessage("new steer", { deliverAs: "steer" })`
- **AND** the bridge SHALL NOT clear the steering queue
- **AND** the next `queue_update` SHALL show `steering: ["earlier steer", "new steer"]`

#### Scenario: Idle send bypasses queue routing
- **WHEN** the agent is idle
- **AND** the bridge receives `send_prompt { text: "hi" }` (with or without `delivery` field)
- **THEN** the bridge SHALL call `pi.sendUserMessage("hi")` without any `deliverAs` option
- **AND** the bridge SHALL NOT call `clearFollowUpQueue` or `clearSteeringQueue`

### Requirement: Protocol `send_prompt` messages carry optional delivery field

`SendPromptToExtensionMessage` and `SendPromptToBrowserMessage` SHALL include an optional `delivery?: "steer" | "followUp"` field. When absent, the receiver SHALL treat the message as `delivery: "followUp"`. The server SHALL pass `delivery` through transparently from browser → bridge without inspection or modification.

#### Scenario: delivery field survives server pass-through
- **WHEN** a browser sends `send_prompt { sessionId: "S", text: "hi", delivery: "steer" }`
- **THEN** the server SHALL forward `send_prompt { type: "send_prompt", sessionId: "S", text: "hi", delivery: "steer" }` to the bridge

#### Scenario: Absent delivery field is preserved as absent
- **WHEN** a browser sends `send_prompt { sessionId: "S", text: "hi" }` without `delivery`
- **THEN** the server SHALL forward without `delivery`
- **AND** the bridge SHALL treat as followUp

### Requirement: Server caches per-session queue state from `queue_update` events

The server SHALL maintain a per-session `pendingQueues: { steering: string[]; followUp: string[] }` field inside `SessionUiState`. The field SHALL be updated whenever a `queue_update` ExtensionToServerMessage arrives from a bridge for that session. The server SHALL include `pendingQueues` in every `session_updated` broadcast and in the initial-state replay sent on browser subscribe.

This replaces the prior `queue.pending: PendingPrompt[]` cache, which was sourced from the deleted `queue_state` event.

#### Scenario: queue_update populates the cache
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: ["a", "b"], followUp: ["c"] }`
- **THEN** the server SHALL set `SessionUiState[S].pendingQueues = { steering: ["a", "b"], followUp: ["c"] }`
- **AND** the server SHALL broadcast `session_updated` with the new value to subscribers

#### Scenario: Empty arrays clear the cache slot
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [], followUp: [] }`
- **THEN** the server SHALL set `SessionUiState[S].pendingQueues = { steering: [], followUp: [] }`
- **AND** the server SHALL broadcast `session_updated`

#### Scenario: Reconnect replays the cached state
- **WHEN** a browser subscribes to session "S" whose `pendingQueues` is non-empty
- **THEN** the initial-state snapshot SHALL include the current `pendingQueues` value
- **AND** the client SHALL render chips for both arrays without waiting for a fresh `queue_update`

### Requirement: Queue panel renders above the chat input

When `Session.queue.pending.length > 0` for the currently selected session, the chat view SHALL render a queue panel between the message list and the chat input. The panel SHALL list each queued message as a chip displaying the message text truncated to one line with overflow ellipsis. The panel SHALL include a "Clear all" affordance that, when clicked, sends a `clear_queue { sessionId }` message for the active session.

#### Scenario: Empty queue hides the panel
- **WHEN** `Session.queue.pending` is `[]`
- **THEN** the queue panel SHALL NOT be rendered

#### Scenario: Non-empty queue renders chips in insertion order
- **WHEN** `Session.queue.pending` is `[{id:"q1",text:"A"},{id:"q2",text:"B"},{id:"q3",text:"C"}]`
- **THEN** the queue panel SHALL render three chips in order: `A`, `B`, `C`

#### Scenario: Long message text truncates
- **WHEN** a queue chip's message text exceeds the chip's render width
- **THEN** the chip SHALL display the text with an ellipsis and SHALL NOT wrap to multiple lines

#### Scenario: Clear all sends clear_queue
- **WHEN** the user clicks the queue panel's "Clear all" button while subscribed to session S
- **THEN** the client SHALL send `clear_queue { type: "clear_queue", sessionId: "S" }` to the server

#### Scenario: Per-chip remove button sends remove_queue_entry
- **WHEN** the user clicks the X button on a chip whose entry id is `E` while subscribed to session S
- **THEN** the client SHALL send `remove_queue_entry { type: "remove_queue_entry", sessionId: "S", id: "E" }` to the server

#### Scenario: Each chip exposes a remove affordance
- **WHEN** the queue panel renders any chip
- **THEN** that chip SHALL include an X / remove button that, on click, invokes the per-entry remove flow

### Requirement: Client sends steer by default, followUp on modifier key

The command input SHALL send `delivery: "steer"` when the user presses Enter, and `delivery: "followUp"` when the user presses Alt+Enter (or Option+Enter on macOS). The send button click SHALL default to `delivery: "steer"`. This mirrors pi's TUI keyboard contract where Enter = steer and Alt+Enter = followUp.

The `PendingPrompt` in the client-side `SessionState` SHALL carry the `delivery` field so the optimistic chip can distinguish steering from follow-up visually.

#### Scenario: Enter sends steer
- **WHEN** the user types text and presses Enter
- **THEN** the client SHALL send `send_prompt { delivery: "steer", text, ... }`

#### Scenario: Alt+Enter sends followUp
- **WHEN** the user types text and presses Alt+Enter
- **THEN** the client SHALL send `send_prompt { delivery: "followUp", text, ... }`

#### Scenario: Send button defaults to steer
- **WHEN** the user clicks the send button
- **THEN** the client SHALL send `send_prompt { delivery: "steer", text, ... }`

#### Scenario: Optimistic chip shows delivery label
- **WHEN** `pendingPrompt.delivery === "steer"` and the chip is visible
- **THEN** the chip SHALL display a label indicating "steering" (or equivalent visual distinction)
- **WHEN** `pendingPrompt.delivery === "followUp"` and the chip is visible
- **THEN** the chip SHALL display a label indicating "follow-up"

### Requirement: Command input handles Alt+Enter distinct from Enter

The `CommandInput` component SHALL listen for `AltGraph + Enter` AND `Alt + Enter` key combinations, treating both as the follow-up send gesture. The existing `Enter` (unmodified) handler SHALL remain steer. Shift+Enter SHALL continue to insert a newline (existing behavior, unchanged).

#### Scenario: Alt+Enter sends followUp
- **WHEN** the user presses Alt+Enter (or Option+Enter on macOS) in the command input with text
- **THEN** the `onSend` callback SHALL be invoked with `delivery: "followUp"`

#### Scenario: Shift+Enter inserts newline (unchanged)
- **WHEN** the user presses Shift+Enter in the command input
- **THEN** a newline character SHALL be inserted and the cursor SHALL advance to the next line
- **AND** no send action SHALL fire

### Requirement: Image attachments are not displayed on chips in v1

Pi 0.74 receives image-bearing prompts via `pi.sendUserMessage(content, ...)` where `content` is an array of `TextContent | ImageContent`. The bridge holds the original `images` array on the `PendingPrompt`, but in v1 the queue chips SHALL render text only and SHALL NOT display image previews. When the user sends an image-bearing prompt that enters the bridge queue, the optimistic-prompt card SHALL still render with image thumbnails (per the existing `optimistic-prompt` capability) until that prompt is observed in the queue, at which point the card SHALL be replaced by a text-only chip and the image previews SHALL no longer be visible.

#### Scenario: Image-bearing send shows optimistic card with images, then text-only chip
- **WHEN** the user sends `{ text: "describe", images: [PNG] }` while the agent is streaming
- **THEN** initially an optimistic card SHALL render with the text and the PNG thumbnail
- **WHEN** the next `queue_state` event reports `pending: [{id:..., text:"describe", images:[PNG]}]`
- **THEN** the optimistic card SHALL be replaced by a text-only chip displaying "describe" with no image thumbnail

#### Scenario: Drain preserves image attachments
- **WHEN** the bridge drains a `PendingPrompt` that carries `images`
- **THEN** the bridge SHALL call `pi.sendUserMessage` with the content array including the original images
- **AND** the resulting agent turn SHALL receive the images via pi's standard image handling

### Requirement: Session card shows a count-only queue indicator

When a session's `queue.pending.length > 0`, the session card in the session list SHALL display a small queue indicator showing the total count. The indicator SHALL NOT show queue contents — it is an at-a-glance signal only. When the count is zero, no indicator SHALL be rendered.

#### Scenario: Indicator appears when queue non-empty
- **WHEN** `Session.queue.pending` has 3 entries for a session
- **THEN** that session's card SHALL display a queue indicator with the count `3`

#### Scenario: Indicator hidden when queue empty
- **WHEN** `Session.queue.pending` is `[]` for a session
- **THEN** no queue indicator SHALL be rendered on that session's card

### Requirement: Queue render cap keeps the LATEST entries visible

The queue panel SHALL render at most 5 chips inline. If `pending.length > 5`, the panel SHALL render an overflow affordance reading "+N earlier" (where N is the hidden count) on the LEFT, followed by the LATEST 5 chips on the right (in insertion order within the visible window). The just-typed entry is therefore always visible as the rightmost chip; older entries collapse into the overflow indicator. The "+N earlier" affordance is read-only in v1; clicking it has no required action and MAY be made expandable later without protocol change.

#### Scenario: Queue of 4 renders all 4 chips
- **WHEN** `pending.length === 4`
- **THEN** the panel SHALL render 4 chips and SHALL NOT render an overflow affordance

#### Scenario: Queue of 8 renders "+3 earlier" on the LEFT plus the latest 5 chips
- **WHEN** `pending.length === 8` with entries `[A, B, C, D, E, F, G, H]` (oldest first)
- **THEN** the panel SHALL render a single "+3 earlier" affordance followed by chips for `D, E, F, G, H` in that order
- **AND** the rightmost chip SHALL be `H` (the latest entry)

### Requirement: Bridge forwards pi's `queue_update` events to the server

The bridge SHALL subscribe to pi's `queue_update` events (via `pi.events?.on("queue_update", ...)`) and forward each event as a `queue_update` ExtensionToServerMessage carrying `{ sessionId, steering: string[], followUp: string[] }`. The bridge SHALL forward every event without filtering — the server is responsible for caching and broadcasting.

The bridge SHALL register the listener exactly once per pi instance and unregister it on session shutdown / re-register.

#### Scenario: Pi emits queue_update, bridge forwards
- **WHEN** pi emits `{ type: "queue_update", steering: ["x"], followUp: ["y"] }`
- **THEN** the bridge SHALL send `queue_update { sessionId, steering: ["x"], followUp: ["y"] }` to the server

#### Scenario: Bridge unregisters listener on session shutdown
- **WHEN** the bridge receives `shutdown` for a session
- **THEN** the `queue_update` listener for that pi instance SHALL be removed
- **AND** no further forwards SHALL occur for that sessionId

### Requirement: `clear_steering_queue` browser-to-server message

The protocol SHALL define a `clear_steering_queue { type: "clear_steering_queue"; sessionId: string }` message sent from the browser to the server. The server SHALL forward it to the bridge for the named session. The bridge SHALL call `pi.clearSteeringQueue()`. Pi SHALL emit a fresh `queue_update` reflecting the empty steering array, which propagates to the client via the normal forward path.

#### Scenario: Cancel-all wipes pi's steering queue
- **WHEN** `pendingQueues.steering` is `["a", "b", "c"]`
- **AND** the browser sends `clear_steering_queue { sessionId: "S" }`
- **THEN** the bridge SHALL call `pi.clearSteeringQueue()`
- **AND** the resulting `queue_update` SHALL show `steering: []`

#### Scenario: Cancel-all on empty queue is a safe no-op
- **WHEN** `pendingQueues.steering` is `[]`
- **AND** the browser sends `clear_steering_queue { sessionId: "S" }`
- **THEN** the bridge SHALL still call `pi.clearSteeringQueue()` (idempotent)
- **AND** no error SHALL be raised

### Requirement: `clear_followup_slot` browser-to-server message

The protocol SHALL define a `clear_followup_slot { type: "clear_followup_slot"; sessionId: string }` message. The bridge SHALL call `pi.clearFollowUpQueue()`. The resulting `queue_update` SHALL show `followUp: []`.

#### Scenario: Cancel removes the single follow-up entry
- **WHEN** `pendingQueues.followUp` is `["run tests"]`
- **AND** the browser sends `clear_followup_slot { sessionId: "S" }`
- **THEN** the bridge SHALL call `pi.clearFollowUpQueue()`
- **AND** the resulting `queue_update` SHALL show `followUp: []`

### Requirement: `edit_followup_slot` browser-to-server message

The protocol SHALL define an `edit_followup_slot { type: "edit_followup_slot"; sessionId: string; text: string; images?: ImageContent[] }` message. The bridge SHALL apply the same clear-then-send sequence used by `send_prompt {delivery:"followUp"}`: call `pi.clearFollowUpQueue()` THEN `pi.sendUserMessage(text, { deliverAs: "followUp" })`. The resulting `queue_update` SHALL show `followUp: [text]`.

This message is functionally equivalent to `send_prompt {delivery:"followUp"}` but is named distinctly to make UI intent unambiguous (the chip's ✏ button is wired to this message; the textarea's Alt+Enter is wired to `send_prompt`).

#### Scenario: Edit replaces the follow-up slot atomically
- **WHEN** `pendingQueues.followUp` is `["original"]`
- **AND** the browser sends `edit_followup_slot { sessionId: "S", text: "revised" }`
- **THEN** the bridge SHALL call `pi.clearFollowUpQueue()` then `pi.sendUserMessage("revised", { deliverAs: "followUp" })`
- **AND** the resulting `queue_update` SHALL show `followUp: ["revised"]`

#### Scenario: Edit on empty slot just sets the slot
- **WHEN** `pendingQueues.followUp` is `[]`
- **AND** the browser sends `edit_followup_slot { sessionId: "S", text: "newly composed" }`
- **THEN** the bridge SHALL still call `pi.clearFollowUpQueue()` (no-op) then `pi.sendUserMessage(...)`
- **AND** the resulting `queue_update` SHALL show `followUp: ["newly composed"]`

### Requirement: Client renders the `PromptQueuePanel` above `CommandInput`

The client SHALL render a `PromptQueuePanel` component above the chat input bar whenever `state.pendingQueues.steering.length > 0` OR `state.pendingQueues.followUp.length > 0`. The component SHALL render two sub-sections in this order:

1. **Steer chips** (read-only): one chip per entry in `pendingQueues.steering`, in array order. When the array is non-empty, the panel SHALL render a single `[Cancel all steering]` button beneath the chip list, which dispatches `clear_steering_queue` on click. No per-chip buttons SHALL be rendered for steer.

2. **Follow-up chip** (interactive): a single chip rendering `pendingQueues.followUp[0]` when the array is non-empty. The chip SHALL include a `✏` (edit) button and a `✕` (cancel) button. Clicking `✏` SHALL open an inline editor pre-filled with the current text; submitting dispatches `edit_followup_slot`. Clicking `✕` dispatches `clear_followup_slot`. Additional entries (`pendingQueues.followUp[1...]`) are not rendered — see design.md "Risks" for non-dashboard injectors.

The panel SHALL hide entirely when both arrays are empty.

#### Scenario: Steer chips render read-only with bulk cancel
- **WHEN** `pendingQueues.steering` is `["A", "B"]` and `pendingQueues.followUp` is `[]`
- **THEN** the panel SHALL render two read-only chips ("A", "B") and a "Cancel all steering" button
- **AND** no follow-up section SHALL be rendered

#### Scenario: Follow-up chip renders editable + cancelable
- **WHEN** `pendingQueues.followUp` is `["run tests"]` and `pendingQueues.steering` is `[]`
- **THEN** the panel SHALL render one chip with text "run tests" and two buttons (✏ and ✕)
- **AND** no steer section SHALL be rendered

#### Scenario: Both queues populated render both sections
- **WHEN** both arrays are non-empty
- **THEN** the panel SHALL render the steer section first, then the follow-up section, separated by a horizontal divider

#### Scenario: Panel hides when all queues empty
- **WHEN** both `pendingQueues.steering` and `pendingQueues.followUp` are `[]`
- **THEN** the panel SHALL render nothing (no empty-state placeholder)

### Requirement: Client uses authoritative `pendingQueues`, no optimistic chip

The client SHALL NOT maintain an optimistic `pendingPrompt` slot when sending a prompt. Pending state SHALL be rendered exclusively from `state.pendingQueues`, populated via server-broadcast `queue_update` events.

`useSessionActions.handleSend` SHALL dispatch the `send_prompt` WS message and SHALL NOT mutate `state.pendingPrompt`. The `pendingPrompt` field and the `PendingPrompt` type SHALL be removed from `SessionState`.

#### Scenario: Send appears in panel only after queue_update
- **WHEN** the user sends a follow-up via Alt+Enter
- **THEN** no chip SHALL appear immediately
- **AND** when `queue_update` arrives with the new entry, the chip SHALL render

#### Scenario: No optimistic state to reconcile on bridge error
- **WHEN** the bridge fails to call `pi.sendUserMessage` (e.g., session ended mid-send)
- **THEN** no stale optimistic chip SHALL be visible
- **AND** the user retypes if they want to retry

### Requirement: Send-while-occupied on follow-up replaces silently (v1, deprecated in v2)

When the user presses Alt+Enter (or equivalent send-with-followup gesture) while `pendingQueues.followUp.length > 0`, the client SHALL dispatch `send_prompt {delivery:"followUp"}` as normal. The bridge's clear-then-send handler causes the existing slot entry to be discarded. No confirmation modal SHALL be displayed.

**Status**: superseded by Requirement "Follow-up send appends to the queue" below. The v1 replace-semantics relied on the cap-1 invariant which v2 drops.

#### Scenario: Alt+Enter replaces existing follow-up
- **WHEN** `pendingQueues.followUp` is `["original"]`
- **AND** the user types "new" and presses Alt+Enter
- **THEN** the client SHALL send `send_prompt { delivery: "followUp", text: "new" }`
- **AND** no confirmation dialog SHALL be shown
- **AND** the next `queue_update` SHALL show `followUp: ["new"]`

### Requirement: Bridge maintains shadow steering and follow-up queues

Pi's `_emitExtensionEvent` does not forward `queue_update` events to extensions. The bridge SHALL maintain `bridgeSteering: string[]` and `bridgeFollowUp: string[]` per session. Every mutation the bridge performs against pi (sends, clears, edits, promotions, removals) SHALL update the shadow state and emit a `queue_update` ExtensionToServerMessage.

**Drain mechanism (per-entry, mirrors pi):** when pi delivers a queued entry (steer or follow-up), pi emits a user `message_start` with that entry's text as the message content. The bridge SHALL handle this by finding the matching entry in `bridgeSteering[]` first then `bridgeFollowUp[]`, removing the **first** occurrence (FIFO), and emitting a fresh `queue_update`. This mirrors pi's own internal logic in `_processAgentEvent` (pi-coding-agent `agent-session.js`) which performs the same matcher on its private `_steeringMessages` / `_followUpMessages` arrays. Steering is checked first to match pi's order.

**No bulk clear at drain boundaries:** the bridge SHALL NOT bulk-clear `bridgeSteering[]` at `turn_end` nor `bridgeFollowUp[]` at `agent_end`. Pi may emit those boundary events between drains while user-added entries are still pending; a bulk clear would wipe legitimate new entries the user queued during the drain window. The per-entry matcher is the only mechanism that mutates the shadow on drain.

**Session-change reset:** session-change events (new / fork / resume) SHALL reset both arrays to `[]` and emit once. This is a true reset (different session — old queue is meaningless), not a drain artifact.

The shadow queue is the source of truth for the dashboard. External (non-dashboard) consumers that mutate pi's queues bypass the shadow; the dashboard does not reflect such state.

#### Scenario: Bridge records a steer mid-stream
- **WHEN** the agent is streaming
- **AND** the bridge sends `pi.sendUserMessage("focus on X", {deliverAs:"steer"})`
- **THEN** the bridge SHALL append `"focus on X"` to `bridgeSteering[]`
- **AND** the bridge SHALL emit `queue_update { steering: [...], followUp: [...] }`

#### Scenario: Per-entry follow-up drain shrinks the queue incrementally
- **WHEN** `bridgeFollowUp` is `["a", "b", "c"]`
- **AND** pi drains `"a"` by emitting user `message_start` with content `"a"`
- **THEN** the bridge SHALL set `bridgeFollowUp` to `["b", "c"]`
- **AND** the bridge SHALL emit a `queue_update` reflecting the new shorter queue
- **WHEN** pi subsequently drains `"b"`
- **THEN** `bridgeFollowUp` SHALL be `["c"]`
- **WHEN** pi subsequently drains `"c"`
- **THEN** `bridgeFollowUp` SHALL be `[]`

#### Scenario: Per-entry steering drain checked before follow-up
- **WHEN** `bridgeSteering` is `["hello"]` and `bridgeFollowUp` is `["hello"]`
- **AND** pi delivers a user `message_start` with content `"hello"`
- **THEN** the bridge SHALL remove the steering entry first (pi's order)
- **AND** `bridgeSteering` SHALL be `[]` while `bridgeFollowUp` SHALL still be `["hello"]`

#### Scenario: Entries added DURING drain survive
- **WHEN** `bridgeFollowUp` is `["a", "b"]`
- **AND** pi drains `"a"` (queue becomes `["b"]`)
- **AND** the user types `"c"` + Alt+Enter while pi is still working on `"a"`
- **THEN** `bridgeFollowUp` SHALL be `["b", "c"]`
- **AND** when pi eventually drains `"b"` the queue SHALL be `["c"]`
- **AND** when pi drains `"c"` the queue SHALL be `[]`

#### Scenario: Non-matching user message_start does not mutate the shadow
- **WHEN** `bridgeFollowUp` is `["queued"]` and `bridgeSteering` is `[]`
- **AND** pi emits a user `message_start` with content `"fresh send"` (not in either queue)
- **THEN** neither `bridgeSteering` nor `bridgeFollowUp` SHALL be mutated
- **AND** no `queue_update` SHALL be emitted for this event

#### Scenario: Duplicate text removes only the first occurrence (FIFO)
- **WHEN** `bridgeFollowUp` is `["dup", "other", "dup"]`
- **AND** pi drains `"dup"`
- **THEN** `bridgeFollowUp` SHALL be `["other", "dup"]` (first occurrence removed)

#### Scenario: turn_end does NOT bulk-clear steering
- **WHEN** `bridgeSteering` is `["a"]` (e.g. user added it mid-drain after a different entry was already delivered)
- **AND** pi emits `turn_end`
- **THEN** the bridge SHALL NOT mutate `bridgeSteering`
- **AND** `"a"` SHALL remain queued until pi explicitly drains it (per-entry matcher)

#### Scenario: agent_end does NOT bulk-clear follow-up
- **WHEN** `bridgeFollowUp` is `["x"]` (a user-added entry that has not yet been drained)
- **AND** pi emits `agent_end`
- **THEN** the bridge SHALL NOT mutate `bridgeFollowUp`
- **AND** `"x"` SHALL remain queued until pi drains it via user `message_start`

### Requirement: Capture-before-send streaming gate prevents idle-message false-chip

Pi flips `isAgentStreaming` synchronously inside `pi.sendUserMessage` on an idle session (via `agent_start` emission to the extension runner). Therefore the bridge SHALL capture `wasStreaming = isAgentStreaming` **before** calling `pi.sendUserMessage`, and SHALL only record to the shadow queue when `wasStreaming === true`.

Call sites:

- `command-handler.ts` passthrough branch: capture before `sendUserMessageWithImages`, fire `onSteerSent` / `onFollowupSent` only if captured-true.
- `bridge.ts` `sessionPrompt` fallback (slash-route follow-up/steer): same pattern.
- `bridge.ts` `edit_followup_slot` / `edit_followup_entry` handler: same pattern.

The internal gate inside `recordSteerSent` / `recordFollowupSent` SHALL also check `isAgentStreaming` as defense-in-depth.

#### Scenario: Initial idle send produces no chip
- **WHEN** the agent is idle (`isAgentStreaming === false`)
- **AND** the bridge receives `send_prompt { text: "hello", delivery: "steer" }`
- **AND** pi flips `isAgentStreaming` to `true` synchronously inside `pi.sendUserMessage` (via agent_start)
- **THEN** the bridge SHALL NOT append to `bridgeSteering`
- **AND** the bridge SHALL NOT emit `queue_update` with a chip
- **AND** the message SHALL be processed by pi as a fresh turn

#### Scenario: Mid-stream steer produces a chip
- **WHEN** `isAgentStreaming === true` at the moment of `send_prompt {delivery:"steer"}`
- **THEN** the bridge SHALL append to `bridgeSteering`
- **AND** the bridge SHALL emit `queue_update` with the new entry

### Requirement: Pending steer entries render inline in chat as user-style bubbles

The client SHALL render each entry of `Session.pendingQueues.steering[]` as a user-message-style bubble inside `ChatView`, positioned **at the bottom of the message list** (after the last assistant turn and any streaming text). Each rendered bubble SHALL:

- Use the same visual style as a real user message (`bg-blue-500/10 border border-blue-500/20 border-l-2 border-l-blue-400 rounded-xl shadow-md`).
- Display a `STEERING` header (uppercase, tertiary text) with an animated spinner.
- Display a top-right ✕ button that dispatches `clear_steering_queue` (bulk cancel; per-entry steer removal remains out of scope).
- Disappear when `pendingQueues.steering[]` is empty (the bridge clears the shadow on `turn_end`). At that point pi's `message_end` will have already rendered the corresponding user message in chat, so the chat surface looks coherent.

The `QueuePanel.SteerSection` component SHALL be removed.

#### Scenario: Pending steer appears at the bottom of chat
- **WHEN** `Session.pendingQueues.steering` is `["focus on X"]`
- **AND** the message list ends with an assistant message
- **THEN** `ChatView` SHALL render "focus on X" as a user-style bubble after the assistant message, with `STEERING` header + spinner + ✕

#### Scenario: Multiple pending steers render in order
- **WHEN** `Session.pendingQueues.steering` is `["a", "b", "c"]`
- **THEN** `ChatView` SHALL render three bubbles in array order, all positioned at the bottom

#### Scenario: Steer chip disappears when shadow clears
- **WHEN** `Session.pendingQueues.steering` transitions from `["a"]` to `[]` (because pi emitted turn_end)
- **THEN** the inline `STEERING` bubble SHALL disappear
- **AND** the chat SHALL show "a" as a real user message once pi emits `message_end` for that user message

### Requirement: Follow-up is a multi-entry queue with cycling navigation

The bridge SHALL accept arbitrary follow-up depth (soft cap: 20 entries). The client SHALL render the follow-up surface with **one entry visible at a time** and three navigation controls:

- **Up arrow (↑)**: navigate to the previous entry in `pendingQueues.followUp[]` for read-only browsing. Does NOT mutate the queue. Disabled when `currentIndex === 0`.
- **Down arrow (↓)**: navigate to the next entry. Disabled when `currentIndex === pendingQueues.followUp.length - 1`.
- **Promote-to-head (⇧)**: dispatch `promote_followup_entry { sessionId, index: currentIndex }`. Bridge moves entry to position 0 via `pi.clearFollowUpQueue()` + replay; resulting `queue_update` SHALL reflect the new ordering.

The currently-visible entry SHALL be:

- **Click-to-edit**: clicking the body opens inline edit. Submitting (Enter, blur) dispatches `edit_followup_entry { sessionId, index: currentIndex, text }`. The bridge clears + replays; resulting `queue_update` SHALL show the edited text at `currentIndex`.
- **Removable (✕)**: dispatches `remove_followup_entry { sessionId, index: currentIndex }`. Bridge clears + replays the surviving entries; resulting `queue_update` SHALL omit the removed entry.

#### Scenario: Single-entry follow-up shows just one card
- **WHEN** `pendingQueues.followUp` is `["run tests"]`
- **THEN** the client SHALL render one card with text "run tests"
- **AND** ↑ and ↓ SHALL be disabled
- **AND** ⇧ SHALL be either disabled or a no-op (entry already at position 0)

#### Scenario: Multi-entry follow-up shows one with cycling
- **WHEN** `pendingQueues.followUp` is `["a", "b", "c"]` and `currentIndex` starts at 0
- **THEN** the client SHALL render "a" as the visible card
- **AND** ↓ SHALL be enabled (advances to index 1)
- **AND** ↑ SHALL be disabled
- **AND** the card SHALL show a position indicator (e.g. "1 of 3")

#### Scenario: Promote moves entry to head
- **WHEN** `pendingQueues.followUp` is `["a", "b", "c"]` and `currentIndex === 2` (showing "c")
- **AND** the user clicks ⇧
- **THEN** the client SHALL dispatch `promote_followup_entry { index: 2 }`
- **AND** the next `queue_update` SHALL show `followUp: ["c", "a", "b"]`
- **AND** the client SHALL adjust `currentIndex` to 0 to keep showing "c"

#### Scenario: Remove drops one entry
- **WHEN** `pendingQueues.followUp` is `["a", "b", "c"]` and `currentIndex === 1` (showing "b")
- **AND** the user clicks ✕
- **THEN** the client SHALL dispatch `remove_followup_entry { index: 1 }`
- **AND** the next `queue_update` SHALL show `followUp: ["a", "c"]`
- **AND** `currentIndex` SHALL adjust so a valid entry remains visible (clamp to `length - 1`)

#### Scenario: Edit replaces the visible entry in-place
- **WHEN** `pendingQueues.followUp` is `["a", "b", "c"]` and `currentIndex === 1`
- **AND** the user clicks the body, edits to "b-revised", submits
- **THEN** the client SHALL dispatch `edit_followup_entry { index: 1, text: "b-revised" }`
- **AND** the next `queue_update` SHALL show `followUp: ["a", "b-revised", "c"]`
- **AND** `currentIndex` SHALL stay at 1

### Requirement: Follow-up send appends to the queue (v2 replace of v1 send-while-occupied semantics)

When the user presses Alt+Enter (or equivalent send-with-followup gesture), the client SHALL dispatch `send_prompt {delivery:"followUp", text}` as normal. The bridge SHALL append the new entry to `bridgeFollowUp[]` (NOT replace the existing entries). The client SHALL update `currentIndex` to point at the newly-appended entry so the user immediately sees what they just queued.

#### Scenario: Send while queue non-empty appends
- **WHEN** `pendingQueues.followUp` is `["a", "b"]`
- **AND** the user types "c" + Alt+Enter
- **THEN** the bridge SHALL append "c" to `bridgeFollowUp`
- **AND** the next `queue_update` SHALL show `followUp: ["a", "b", "c"]`
- **AND** the client SHALL set `currentIndex` to 2

#### Scenario: Send while queue empty initializes
- **WHEN** `pendingQueues.followUp` is `[]`
- **AND** the user types "first" + Alt+Enter
- **THEN** the bridge SHALL set `bridgeFollowUp` to `["first"]`
- **AND** `currentIndex` SHALL be 0

#### Scenario: Soft cap on queue depth
- **WHEN** `pendingQueues.followUp.length === 20` (soft cap)
- **AND** the user attempts to send another follow-up
- **THEN** the bridge SHALL reject the new entry (drop or emit a toast — implementation choice)
- **AND** the user-visible state SHALL communicate the cap (toast or disabled send)

### Requirement: Drained queued user message renders AFTER the preceding assistant message in chat

When pi drains a queued user message at either boundary (steer at `turn_end`, follow-up at `agent_end`), the resulting user `message_start` event SHALL arrive on the wire AFTER the preceding assistant `message_end` event for the same turn. The client reducer SHALL therefore append the drained user bubble to `state.messages[]` AFTER the assistant's final response, not before it.

This invariant applies to BOTH drain boundaries:

- **Steer drain** at `turn_end` (Enter while streaming)
- **Follow-up drain** at `agent_end` (Alt+Enter while streaming)

At either boundary pi emits four events synchronously back-to-back in this order:

1. `message_end` (assistant — the final response of the just-completed turn)
2. `turn_end` OR `agent_end` (the drain boundary)
3. `message_start` (user — the drained steer or follow-up text)
4. `message_end` (user — same text)

The bridge defers every `message_end` send via `setTimeout(0)` for entryId capture (per `fix-per-message-fork`). To preserve pi's emit order on the wire, the bridge SHALL also defer USER `message_start` sends via the same `setTimeout(0)` so they queue in the timer FIFO behind any pending `message_end` deferrals. The check is on `messageRef.role === "user"` — it does NOT discriminate by drain source (steer / follow-up / fresh send all funnel through the same code path).

The bridge SHALL NOT defer ASSISTANT `message_start` sends — `message_update` events fire synchronously and the reducer's `streamingTextFlushed` reset depends on the assistant `message_start` being processed first.

#### Scenario: Drained STEER appears below the assistant's final response
- **WHEN** the agent is mid-turn streaming `"weather report"`
- **AND** the user types `"asd"` and presses Enter (delivery=steer)
- **AND** the assistant finishes the current turn
- **AND** pi drains the steer at `turn_end`, delivering `"asd"` as a new user message
- **THEN** the wire order received by the client SHALL be: `turn_end`, `message_end` (assistant `"weather report"`), `message_start` (user `"asd"`), `message_end` (user `"asd"`)
- **AND** the client SHALL render `"weather report"` (assistant bubble) ABOVE `"asd"` (user bubble) in the chat

#### Scenario: Drained FOLLOW-UP appears below the assistant's final response
- **WHEN** the agent is mid-turn streaming `"weather report"`
- **AND** the user types `"asd"` and presses Alt+Enter (delivery=followUp)
- **AND** the assistant finishes the entire agent run
- **AND** pi drains the follow-up at `agent_end`, delivering `"asd"` as a new user message
- **THEN** the wire order received by the client SHALL be: `agent_end`, `message_end` (assistant `"weather report"`), `message_start` (user `"asd"`), `message_end` (user `"asd"`)
- **AND** the client SHALL render `"weather report"` (assistant bubble) ABOVE `"asd"` (user bubble) in the chat

#### Scenario: Bridge defers USER message_start, sends ASSISTANT message_start sync
- **WHEN** the bridge handles a `message_start` event
- **AND** the message's `role` is `"user"`
- **THEN** the bridge SHALL queue the `connection.send` via `setTimeout(0)`
- **AND** the bridge SHALL keep `wrapAppendMessageForCtx` + `pendingNonces.set` synchronous (state mutations must run sync before the handler returns)
- **WHEN** the bridge handles a `message_start` event
- **AND** the message's `role` is `"assistant"`
- **THEN** the bridge SHALL call `connection.send` synchronously (so subsequent `message_update` events arrive after the reducer has processed `message_start` and reset `streamingTextFlushed`)

#### Scenario: Multiple drained entries preserve their pi emit order
- **WHEN** a queue contains `["a", "b"]` at the drain boundary (steer or follow-up)
- **AND** pi drains both entries in order
- **THEN** the wire order SHALL be: assistant `message_end`, user `message_start "a"`, user `message_end "a"`, user `message_start "b"`, user `message_end "b"`
- **AND** the chat SHALL render the assistant message first, then `"a"`, then `"b"`

#### Scenario: Idle user send is unaffected by the deferral
- **WHEN** the user sends a prompt on an idle session
- **AND** no `message_end` is pending in the timer queue
- **THEN** the user `message_start` SHALL still be deferred via `setTimeout(0)` (uniform handling)
- **AND** the message SHALL appear in chat after exactly one macrotask delay (visually instant)

### Requirement: Session shutdown resets shadow queues and clears pi's native queues

When the bridge's `shutdown` extension command is invoked (typically via a browser `shutdown { sessionId }` message routed through the server to pi), the bridge SHALL — before invoking `cachedCtx.shutdown()` and before the `setTimeout(process.exit, 500)` safety net — perform a shadow-queue reset:

1. The bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively (guarded by `typeof === "function"` for pi-version skew and wrapped in `try/catch` so teardown never throws). Both calls SHALL run unconditionally regardless of shadow state — external (non-dashboard) consumers may have mutated pi's queues without the bridge knowing.
2. If either `bridgeSteering` or `bridgeFollowUp` is non-empty, the bridge SHALL reset both arrays to `[]` AND emit one final `queue_update { sessionId, steering: [], followUp: [] }` via the existing `emitQueueUpdate` helper. If both shadows are already empty, the bridge SHALL NOT emit `queue_update` (avoids wire noise on the common path).
3. The bridge SHALL THEN invoke the existing `cachedCtx.shutdown()` call.
4. The existing `setTimeout(() => process.exit(0), 500)` safety net is unchanged.

This mirrors the session-change reset semantics (new / fork / resume): different session — old queue is meaningless. Shutdown is the same situation, more so: there is no next session.

The reset SHALL run BEFORE `cachedCtx.shutdown()` so the bridge is still in a known-good state when the final `queue_update` is emitted; pi's own teardown may fire events the bridge no longer processes after `cachedCtx.shutdown()`.

#### Scenario: Shutdown with non-empty steering queue resets and emits

- **WHEN** `bridgeSteering` is `["focus on X"]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` (best-effort)
- **AND** the bridge SHALL set `bridgeSteering` to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once
- **AND** the bridge SHALL THEN invoke `cachedCtx.shutdown()`
- **AND** the existing `setTimeout(process.exit, 500)` safety net SHALL fire as before

#### Scenario: Shutdown with non-empty follow-up queue resets and emits

- **WHEN** `bridgeFollowUp` is `["run tests when done"]` and `bridgeSteering` is `[]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL call `pi.clearFollowUpQueue()` (best-effort)
- **AND** the bridge SHALL set `bridgeFollowUp` to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once

#### Scenario: Shutdown with both queues non-empty resets both

- **WHEN** `bridgeSteering` is `["a", "b"]` and `bridgeFollowUp` is `["c"]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL call BOTH `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()`
- **AND** the bridge SHALL set both shadow arrays to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once (not twice)

#### Scenario: Shutdown with both queues empty does NOT emit queue_update

- **WHEN** `bridgeSteering` is `[]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `shutdown` extension command is invoked
- **THEN** the bridge SHALL still call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively (idempotent — pi's queues may be non-empty from non-dashboard sources)
- **AND** the bridge SHALL NOT emit a `queue_update` event
- **AND** the bridge SHALL invoke `cachedCtx.shutdown()` as before

#### Scenario: Pi missing clearSteeringQueue / clearFollowUpQueue is a safe no-op

- **WHEN** the running pi version does not expose `pi.clearSteeringQueue` (or `clearFollowUpQueue`) as a function
- **AND** the bridge's `shutdown` extension command is invoked with non-empty shadows
- **THEN** the bridge SHALL skip the missing call (guarded by `typeof === "function"`)
- **AND** the bridge SHALL still reset the shadow arrays to `[]` and emit the final `queue_update`
- **AND** teardown SHALL proceed to `cachedCtx.shutdown()` without throwing

#### Scenario: pi clear-queue calls throw — teardown continues

- **WHEN** `pi.clearSteeringQueue()` throws an exception during shutdown
- **THEN** the bridge SHALL catch the exception (no re-throw)
- **AND** the bridge SHALL still proceed to reset the shadow arrays
- **AND** the bridge SHALL still emit the final `queue_update`
- **AND** the bridge SHALL still invoke `cachedCtx.shutdown()`

#### Scenario: Reset runs BEFORE cachedCtx.shutdown()

- **WHEN** the bridge's `shutdown` extension command is invoked with non-empty shadows
- **THEN** the order of operations SHALL be: (1) defensive `pi.clearSteeringQueue` / `clearFollowUpQueue`, (2) shadow reset + `emitQueueUpdate`, (3) `cachedCtx.shutdown()`, (4) `setTimeout(process.exit, 500)`
- **AND** the final `queue_update` SHALL be emitted while the bridge connection is still in a known-good state

### Requirement: User abort resets shadow queues and clears pi's native queues

When the bridge's `abort` extension command is invoked (via a browser `abort { sessionId }` message routed through the server to pi), the bridge SHALL — before invoking `cachedCtx.abort()` — perform the same shadow-queue reset used by the shutdown command:

1. The bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively (guarded by `typeof === "function"` and wrapped in `try/catch`). Both run unconditionally.
2. If either `bridgeSteering` or `bridgeFollowUp` is non-empty, the bridge SHALL reset both to `[]` AND emit one final `queue_update { sessionId, steering: [], followUp: [] }`. Empty shadows SHALL NOT emit `queue_update`.
3. The bridge SHALL THEN invoke the existing `cachedCtx.abort()` call.
4. The existing `retryTracker.noteAbort(sessionId)` + `usageLimitOrderer.noteRetryEnd(sessionId)` calls SHALL remain after `cachedCtx.abort()`.

Rationale: user clicked Stop. Mental model is "stop everything" — queued messages must not be delivered after the abort settles. Matches pi-TUI's `restoreQueuedMessagesToEditor({abort: true})` behavior (`pi-coding-agent/dist/modes/interactive/interactive-mode.js:3040`).

#### Scenario: Abort with non-empty steering resets, emits, then calls cachedCtx.abort

- **WHEN** `bridgeSteering` is `["focus on X"]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `abort` extension command is invoked
- **THEN** the bridge SHALL call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively
- **AND** the bridge SHALL set `bridgeSteering` to `[]`
- **AND** the bridge SHALL emit `queue_update { sessionId, steering: [], followUp: [] }` exactly once
- **AND** the bridge SHALL THEN invoke `cachedCtx.abort()`

#### Scenario: Abort with both queues empty does NOT emit queue_update

- **WHEN** `bridgeSteering` is `[]` and `bridgeFollowUp` is `[]`
- **AND** the bridge's `abort` extension command is invoked
- **THEN** the bridge SHALL still call `pi.clearSteeringQueue()` and `pi.clearFollowUpQueue()` defensively
- **AND** the bridge SHALL NOT emit `queue_update`
- **AND** the bridge SHALL invoke `cachedCtx.abort()` as before

#### Scenario: Pi missing clear-queue functions — abort still proceeds without throw

- **WHEN** the running pi version does not expose `pi.clearSteeringQueue` as a function
- **AND** the bridge's `abort` extension command is invoked with non-empty shadows
- **THEN** the bridge SHALL skip the missing call (guarded by `typeof === "function"`)
- **AND** the bridge SHALL still reset the shadow arrays and emit the final `queue_update`
- **AND** the bridge SHALL still invoke `cachedCtx.abort()`

### Requirement: Client restores aborted queue text into the command-input draft

When the user clicks **Stop** (dispatches `abort`), the client SHALL — BEFORE sending the WS `abort` message — snapshot the selected session's `pendingQueues` and merge the queued text into the command-input draft. This mirrors pi-TUI's `restoreQueuedMessagesToEditor` so typed messages are not silently lost.

Order of merge SHALL be:

1. Concatenate `pendingQueues.steering[]` then `pendingQueues.followUp[]` (each entry separated by `\n\n`, dropping entries that are empty after `trim()`).
2. Append the current draft text (also dropped if empty after `trim()`), separated from the queued text by `\n\n`.
3. Result: `editor = [queuedJoined, currentDraft].filter(t => t.trim()).join("\n\n")`.

The merge SHALL be a no-op (no draft change) when both queues are empty. Image attachments SHALL NOT be modified — only the text draft is updated.

#### Scenario: Stop with one steer + one followUp + typed draft restores all three

- **WHEN** `pendingQueues.steering` is `["do X"]`
- **AND** `pendingQueues.followUp` is `["then Y"]`
- **AND** the command-input draft is `"extra thought"`
- **AND** the user clicks Stop
- **THEN** the client SHALL set the draft to `"do X\n\nthen Y\n\nextra thought"` BEFORE dispatching the WS `abort` message

#### Scenario: Stop with queues but empty draft restores queued text only

- **WHEN** `pendingQueues.steering` is `["do X"]` and `pendingQueues.followUp` is `[]`
- **AND** the draft is empty (or whitespace-only)
- **AND** the user clicks Stop
- **THEN** the client SHALL set the draft to `"do X"`

#### Scenario: Stop with empty queues leaves draft untouched

- **WHEN** `pendingQueues.steering` is `[]` and `pendingQueues.followUp` is `[]`
- **AND** the draft is `"hello"`
- **AND** the user clicks Stop
- **THEN** the client SHALL NOT modify the draft
- **AND** the WS `abort` message SHALL still be dispatched

#### Scenario: Steer entries come before followUp entries in the merged draft

- **WHEN** `pendingQueues.steering` is `["steerA", "steerB"]`
- **AND** `pendingQueues.followUp` is `["followA"]`
- **AND** the draft is empty
- **AND** the user clicks Stop
- **THEN** the draft SHALL become `"steerA\n\nsteerB\n\nfollowA"`

