# Mid-turn Prompt Queue

## Purpose

Surface per-session pending-prompt state typed while the agent is mid-turn. Users compose steering and follow-up prompts during streaming; pi's native queues hold them, the bridge mirrors state via shadow queues, the server caches the snapshot from `queue_update` events, and the client renders the `PromptQueuePanel` above the chat input. Steering drains incrementally at `turn_end` boundaries; follow-up drains incrementally at `agent_end` boundaries — both per-entry by user `message_start` matcher.
## Requirements
### Requirement: Typed-during-streaming prompts are forwarded to pi's native queues

When the bridge receives a `send_prompt` message AND `getBridgeState().isAgentStreaming === true` for the target session AND the prompt is not a slash, bash, compact, reload, new, model, or mgmt command, the bridge SHALL route based on `msg.delivery` — follow-up goes to the bridge-owned buffer, steer goes to pi's queue:

- If `delivery === "followUp"` (or absent — backward-compat default), the bridge SHALL push a `{ text, images? }` entry into its in-memory `bridgeFollowUp` buffer AND emit `queue_update { sessionId, steering, followUp }` carrying the entry VIEWS (`{ text, imageCount }`), never image bytes. The bridge SHALL NOT call `pi.sendUserMessage(text, { deliverAs: "followUp" })`. Pi does not receive the message until the drain loop ships it later (see "Bridge follow-up drain loop runs on agent_end").

- If `delivery === "steer"`, the bridge SHALL call `pi.sendUserMessage(text, { deliverAs: "steer" })` directly. Steer remains pi-owned; the bridge tracks shadow steering via `recordSteerSent` + drain-by-`message_start`-matcher (unchanged from prior architecture).

The bridge SHALL NOT call `pi.clearSteeringQueue()`, `pi.clearFollowUpQueue()`, or `pi.clearAllQueues()` from any code path. None of these methods are exposed on pi's ExtensionAPI through pi 0.76.0.

When `getBridgeState().isAgentStreaming === false` (idle session), the bridge SHALL call `pi.sendUserMessage(text)` directly with no `deliverAs` option, starting a fresh turn. Idle sends bypass the buffer entirely (no chip appears).

#### Scenario: Follow-up send while streaming buffers in bridge
- **WHEN** the agent is streaming
- **AND** `bridgeFollowUp` is `["original"]`
- **AND** the bridge receives `send_prompt { text: "second", delivery: "followUp" }`
- **THEN** the bridge SHALL push to `bridgeFollowUp`, making it `[{text:"original"}, {text:"second"}]`
- **AND** the bridge SHALL emit `queue_update { followUp: [{text:"original", imageCount:0}, {text:"second", imageCount:0}] }`
- **AND** the bridge SHALL NOT call `pi.sendUserMessage` at all for this message

#### Scenario: Steer send during streaming routes to pi directly
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "focus on auth", delivery: "steer" }`
- **THEN** the bridge SHALL call `pi.sendUserMessage("focus on auth", { deliverAs: "steer" })`
- **AND** the bridge SHALL push to `bridgeSteering` via `recordSteerSent`
- **AND** the bridge SHALL emit `queue_update`

#### Scenario: Idle send bypasses the buffer
- **WHEN** the agent is idle
- **AND** the bridge receives `send_prompt { text: "hi" }`
- **THEN** the bridge SHALL call `pi.sendUserMessage("hi")` with no `deliverAs`
- **AND** the bridge SHALL NOT touch `bridgeFollowUp` or `bridgeSteering`

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

The server SHALL maintain a per-session `pendingQueues: { steering: string[]; followUp: FollowUpEntryView[] }` field inside `SessionUiState`, where `FollowUpEntryView = { text: string; imageCount: number }`. The field SHALL be updated whenever a `queue_update` ExtensionToServerMessage arrives from a bridge for that session. The server SHALL include `pendingQueues` in every `session_updated` broadcast and in the initial-state replay sent on browser subscribe.

The server SHALL forward `followUp` entries verbatim and SHALL NOT inspect, rewrite, or validate their fields. `steering` remains `string[]` (pi-owned, display-only, never image-bearing).

This replaces the prior `queue.pending: PendingPrompt[]` cache, which was sourced from the deleted `queue_state` event.

#### Scenario: queue_update populates the cache
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: ["a", "b"], followUp: [{ text: "c", imageCount: 0 }] }`
- **THEN** the server SHALL set `SessionUiState[S].pendingQueues = { steering: ["a", "b"], followUp: [{ text: "c", imageCount: 0 }] }`
- **AND** the server SHALL broadcast `session_updated` with the new value to subscribers

#### Scenario: Image-bearing entry round-trips its count
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [], followUp: [{ text: "describe", imageCount: 2 }] }`
- **THEN** the server SHALL set `pendingQueues.followUp` to `[{ text: "describe", imageCount: 2 }]`
- **AND** the broadcast SHALL carry `imageCount: 2` unmodified
- **AND** no image `data` field SHALL be present anywhere in the broadcast payload

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

### Requirement: Bridge maintains shadow steering and follow-up queues

Pi's ExtensionAPI does not forward `queue_update` events to extensions (verified through pi 0.76.0). The bridge SHALL maintain two distinct per-session in-memory structures with different ownership semantics:

- **`bridgeSteering: string[]` (pi-OWNED + SHADOW)** — mirrors pi's `Agent.steeringQueue`. Mutated only by `recordSteerSent` (on bridge-originated steer sends) + drain-by-`message_start`-matcher (when pi delivers a queued steer entry, the matching text is spliced).
- **`bridgeFollowUp: FollowUpEntry[]` (BRIDGE-OWNED BUFFER)** — authoritative store for dashboard-originated follow-up entries while the agent is streaming, where `FollowUpEntry = { text: string; images?: ImageContent[] }`. Pi never sees these entries until the drain loop ships them on `agent_end`. Mutated by `bufferFollowupSend` (on push), `enqueueSystemFollowup` (on system push), `drainFollowupQueue` (on pop), and the four mutation handlers (`edit_followup_entry`, `remove_followup_entry`, `promote_followup_entry`, `clear_followup_entries`).

An entry's images SHALL be stored on the entry itself, never in a parallel index-keyed structure, so that every splice/unshift/shift preserves the text↔images association structurally.

Both structures feed the same `queue_update { sessionId, steering: [...], followUp: [...] }` ExtensionToServerMessage, where each `followUp` element is projected to `{ text, imageCount }`. Image bytes SHALL NOT be included in `queue_update`. The server caches the snapshot and broadcasts to subscribed browsers.

**Session-change reset:** session-change events (new / fork / resume) SHALL reset both arrays to `[]` and emit `queue_update` once. Different session — old state is meaningless. Buffered image bytes are released with the entries.

**Bridge restart:** both structures are in-memory only; bridge process restart (`/reload`, dashboard restart, pi crash) loses them, including any buffered image bytes. Symmetric with pi's own queue behavior.

#### Scenario: Bridge records a steer mid-stream
- **WHEN** the agent is streaming
- **AND** the bridge sends `pi.sendUserMessage("focus on X", {deliverAs:"steer"})`
- **THEN** the bridge SHALL append `"focus on X"` to `bridgeSteering`
- **AND** the bridge SHALL emit `queue_update { steering: [...], followUp: [...] }`

#### Scenario: Per-entry steering drain via message_start matcher
- **WHEN** `bridgeSteering` is `["a", "b", "c"]`
- **AND** pi drains `"a"` by emitting user `message_start` with content `"a"` at `turn_end`
- **THEN** the bridge SHALL set `bridgeSteering` to `["b", "c"]`
- **AND** the bridge SHALL emit `queue_update`

#### Scenario: Steering matcher checked before follow-up matcher
- **WHEN** `bridgeSteering` is `["hello"]` and `bridgeFollowUp` is `[{ text: "hello" }]`
- **AND** pi delivers user `message_start` with content `"hello"`
- **THEN** the bridge SHALL remove the steering entry first (matches pi's emit order)
- **AND** `bridgeSteering` SHALL become `[]` while `bridgeFollowUp` SHALL still contain `[{ text: "hello" }]`

#### Scenario: Follow-up matcher is a no-op for buffered entries
- **WHEN** `bridgeFollowUp` is `[{ text: "queued by dashboard" }]` (buffered, not yet drained)
- **AND** the agent finishes its turn and the drain loop pops that entry and sends it via `pi.sendUserMessage` with no `deliverAs`
- **AND** pi emits user `message_start` with content `"queued by dashboard"` for the fresh turn
- **THEN** the matcher SHALL look up `"queued by dashboard"` among `bridgeFollowUp` entry texts and find `-1` (already popped by the drain loop)
- **AND** the splice SHALL be a no-op; no `queue_update` emitted from the matcher path

#### Scenario: Session-change resets both structures
- **WHEN** the bridge handles `session_start` with `reason ∈ {"new", "fork", "resume"}`
- **AND** either `bridgeSteering` or `bridgeFollowUp` is non-empty
- **THEN** the bridge SHALL set both to `[]`
- **AND** the bridge SHALL emit `queue_update { steering: [], followUp: [] }` once

#### Scenario: Session-change releases buffered image bytes
- **WHEN** `bridgeFollowUp` holds an entry carrying images
- **AND** the bridge handles `session_start` with `reason: "resume"`
- **THEN** `bridgeFollowUp` SHALL become `[]`
- **AND** the buffer's accounted byte total SHALL return to zero

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
- Disappear when `pendingQueues.steering[]` is empty (the bridge clears the shadow on `turn_end`). At that point pi's `message_end` will have already rendered the corresponding user message in chat, so the chat surface looks coherent.

The per-entry ✕ cancel button is REMOVED. Pi's `ExtensionAPI` (verified through pi 0.75.5) does NOT expose `clearSteeringQueue` or `clearFollowUpQueue`; the bridge's previous `(pi as any).clearSteeringQueue?.()` call was a silent no-op via the `typeof === "function"` guard. Clicking ✕ cleared the bridge shadow but pi still delivered the queued message at the next drain — a misleading UI. Until pi exposes queue mutation on `ExtensionContext`, the steer cards remain visible (so the user knows what's queued) but offer no cancel affordance.

The `QueuePanel.SteerSection` component SHALL be removed.

#### Scenario: Pending steer appears at the bottom of chat
- **WHEN** `Session.pendingQueues.steering` is `["focus on X"]`
- **AND** the message list ends with an assistant message
- **THEN** `ChatView` SHALL render "focus on X" as a user-style bubble after the assistant message, with `STEERING` header + spinner
- **AND** the bubble SHALL NOT render a ✕ cancel button

#### Scenario: Multiple pending steers render in order without cancel buttons
- **WHEN** `Session.pendingQueues.steering` is `["a", "b", "c"]`
- **THEN** `ChatView` SHALL render three bubbles in array order, all positioned at the bottom
- **AND** no `data-testid="pending-steer-cancel"` element SHALL be present in the DOM

#### Scenario: Steer chip disappears when shadow clears
- **WHEN** `Session.pendingQueues.steering` transitions from `["a"]` to `[]` (because pi emitted turn_end and the bridge per-entry drain matcher removed the entry)
- **THEN** the inline `STEERING` bubble SHALL disappear
- **AND** the chat SHALL show "a" as a real user message once pi emits `message_end` for that user message

#### Scenario: Bridge `clear_steering_queue` handler still clears shadow (for stale clients)
- **WHEN** the bridge receives `clear_steering_queue { sessionId }` (e.g. from a stale client that still has the ✕ button)
- **THEN** the bridge SHALL set `bridgeSteering = []`
- **AND** the bridge SHALL emit `queue_update { steering: [], followUp: <unchanged> }`
- **AND** the bridge SHALL NOT log a warning about the missing pi method (silent no-op)
- **AND** pi's internal `_steeringMessages` queue SHALL still deliver at the next drain (known limitation — see upstream pi feature request)

### Requirement: User abort resets shadow queues and clears pi's native queues

When the bridge's `abort` extension command is invoked (via a browser `abort { sessionId }` message routed through the server to pi), the bridge SHALL:

1. Latch the abort (`abortLatch.request(sessionId)`) BEFORE invoking `cachedCtx.abort()`, so a long provider backoff that outlives the 2 s persistent-abort scheduler still stops pi when it wakes to retry.
2. Invoke `cachedCtx.abort()`.
3. Call `retryTracker.noteAbort(sessionId)` (clears the in-flight attempt counter). The bridge SHALL NOT call `usageLimitOrderer.noteRetryEnd(sessionId)`; the orderer's `pending` flag MUST survive user-initiated abort so that pi's eventual terminal `agent_end` can still surface the real provider `errorMessage` via the orderer's `maybeSynthesize` path.

The bridge SHALL NOT reset `bridgeSteering` or `bridgeFollowUp` on abort, and SHALL NOT emit a `queue_update` from the abort path. Pi's ExtensionAPI exposes no queue-clear primitive, so the shadows continue to mirror pi's actual retained queues; emptying them would make the dashboard claim a state pi is not in.

Because the follow-up buffer survives abort, its retained bytes also survive. The aggregate byte ceiling is unaffected: the accounted total is derived from the live entries at each check, so a surviving buffer simply continues to be accounted.

The wrapper-abort SHALL run exactly ONCE on the initial `abort` command. Subsequent persistent-abort scheduler ticks (see `provider-retry-state` "Bridge persistent-abort scheduler closes retry race") SHALL invoke `cachedCtx.abort()` directly (raw), NOT the wrapper.

#### Scenario: Abort does not clear the follow-up buffer
- **WHEN** `bridgeFollowUp` holds two entries, one carrying images
- **AND** the bridge's `abort` extension command is invoked
- **THEN** the bridge SHALL invoke `cachedCtx.abort()`
- **AND** `bridgeFollowUp` SHALL still hold both entries with their images
- **AND** the bridge SHALL NOT emit `queue_update` from the abort path

#### Scenario: Abort latches before invoking abort
- **WHEN** the user dispatches `abort`
- **THEN** `abortLatch.request(sessionId)` SHALL be called BEFORE `cachedCtx.abort()`
- **AND** `retryTracker.noteAbort(sessionId)` SHALL be called after
- **AND** the bridge SHALL NOT call `usageLimitOrderer.noteRetryEnd(sessionId)`

#### Scenario: Orderer pending survives user abort during retry
- **GIVEN** the orderer's `pending` flag is `true` for the session (retry chain in flight)
- **WHEN** the user dispatches `abort`
- **THEN** `usageLimitOrderer.hasPending(sessionId)` SHALL remain `true` after the wrapper completes
- **AND** when pi subsequently emits `agent_end` with `errorMessage` matching `USAGE_LIMIT_PATTERN`, the orderer's `maybeSynthesize` SHALL fire and forward the synthesized terminal `auto_retry_end{finalError}` carrying the real provider message

#### Scenario: Wrapper-abort runs once, persistent ticks run raw
- **WHEN** the user dispatches `abort` for a session with a non-empty buffer
- **THEN** the wrapper-abort body SHALL execute exactly once
- **AND** subsequent persistent-abort scheduler ticks within the 2 s window SHALL each invoke `cachedCtx.abort()` directly
- **AND** the persistent ticks SHALL NOT reset bridge shadows or emit `queue_update`

### Requirement: Follow-up send appends to the queue (v2 replace of v1 send-while-occupied semantics)

When the user presses Alt+Enter (or equivalent send-with-followup gesture), the client SHALL dispatch `send_prompt { delivery: "followUp", text, images? }`. The bridge SHALL append the new entry to `bridgeFollowUp[]` (never replace existing entries), carrying any `images` from the `send_prompt` message onto the entry. The client SHALL update `currentIndex` to point at the newly-appended entry.

A send is admitted only when it passes BOTH the entry-count cap and the aggregate byte ceiling. A refused send SHALL NOT be partially admitted: the bridge SHALL NOT strip images from an entry to make it fit.

#### Scenario: Send while buffer non-empty appends
- **WHEN** `pendingQueues.followUp` is `[{ text: "a", imageCount: 0 }, { text: "b", imageCount: 0 }]`
- **AND** the user types "c" + Alt+Enter
- **THEN** the bridge SHALL append `{ text: "c" }` to `bridgeFollowUp`
- **AND** the next `queue_update` SHALL show `followUp` texts `["a", "b", "c"]`
- **AND** the client SHALL set `currentIndex` to 2

#### Scenario: Send while buffer empty initializes
- **WHEN** `pendingQueues.followUp` is `[]`
- **AND** the user types "first" + Alt+Enter
- **THEN** the bridge SHALL set `bridgeFollowUp` to `[{ text: "first" }]`
- **AND** the next `queue_update` SHALL show `followUp` texts `["first"]`
- **AND** `currentIndex` SHALL be 0

#### Scenario: Image-bearing send carries its images onto the entry
- **WHEN** the agent is streaming
- **AND** the client dispatches `send_prompt { delivery: "followUp", text: "describe", images: [PNG, JPEG] }`
- **THEN** the bridge SHALL append `{ text: "describe", images: [PNG, JPEG] }` to `bridgeFollowUp`
- **AND** the next `queue_update` SHALL show that entry with `imageCount: 2`

#### Scenario: Soft cap on buffer depth refuses with visible feedback
- **WHEN** `bridgeFollowUp.length === 20` (soft cap)
- **AND** the user attempts to send another follow-up
- **THEN** the bridge SHALL reject the new entry
- **AND** `bridgeFollowUp` SHALL remain at length 20
- **AND** the bridge SHALL emit `command_feedback { command: "send_prompt", status: "error" }` naming the queue-depth limit
- **AND** the refusal SHALL NOT be silent (a bare log is insufficient)

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

### Requirement: Bridge follow-up drain loop runs on agent_end with pop-before-send invariant

The bridge SHALL subscribe to pi's `agent_end` event and schedule `drainFollowupQueue()` via `setTimeout(_, 0)` (NOT `queueMicrotask`). The setTimeout is required to escape pi's run lifecycle: pi emits `agent_end` to extensions INSIDE the executor body of `runWithLifecycle`, but pi's `finishRun()` (which flips `isStreaming=false` and clears `activeRun`) only runs in the `finally` block AFTER the executor returns. A microtask runs before that finally; a setTimeout runs after. (Verified at pi-coding-agent `pi-agent-core/agent.js:307-330` for pi 0.76.0.)

The drain function SHALL enforce the following invariants in order:

1. **Re-entrancy lock**: a boolean `isDraining` SHALL prevent overlapping drain frames. Set true after gates pass; cleared in `finally`. Re-entrant calls early-return.
2. **Empty-buffer gate**: if `bridgeFollowUp.length === 0`, drain bails immediately. No-op.
3. **TUI-coexistence gate**: if `ctx.hasPendingMessages()` returns true (pi's own queue still has TUI-sent items), drain bails. The method lives on `ctx` (verified at pi 0.76.0 `extensions/types.d.ts:227`) and SHALL be guarded by `typeof === "function"` for older pi.
4. **Idle retry gate**: if `ctx.isIdle()` returns false (pi still in transition window post-agent_end), drain SHALL re-schedule itself via `setTimeout(..., 100)` with a bounded retry counter (max ~20 retries / 2s). After the cap, drain logs a warning and gives up. NOTE: an earlier design draft (D2 v1) gated on `isIdle()` and bailed immediately on false; smoke testing showed this blocks drain entirely because pi's `finishRun()` hasn't flipped state yet at scheduling time.
5. **Pop FIRST**: `bridgeFollowUp.shift()` captures the front entry BEFORE any pi call. The entry — text AND images — exists only on the call stack from this point.
6. **Emit BEFORE send**: `emitQueueUpdate()` SHALL fire reflecting the popped state BEFORE calling pi. Wire-state matches buffer-state at all observable moments.
7. **Fresh-turn send, NO deliverAs**: the drain SHALL call `pi.sendUserMessage(content)` with NO options, where `content` is the entry's text alone when it carries no images, or a content array `[{type:"text"}, {type:"image"}...]` assembled from the entry's text and images when it does. Pi is now idle (passed the gate), so pi starts a new run via `Agent.prompt()`. NOTE: an earlier draft (D2 v2) tried `{ deliverAs: "followUp" }` to handle the transition window; smoke testing showed pi accepts the message into `Agent.followUpQueue` but its `getFollowUpMessages()` callback (called only inside `runAgentLoop`) has already exited — the queued entry never drains. Hence the strict requirement: wait for true idle, then fresh-turn send. The shared content-assembly helper SHALL NOT carry send options into this call site.
8. **Catch + drop on pi error**: any synchronous exception from `pi.sendUserMessage` SHALL be caught, logged as `console.warn`, and the entry SHALL be considered lost. The bridge SHALL NOT re-push.

The drain SHALL handle at most one entry per `agent_end`. Multiple queued entries drain across multiple agent turns in FIFO order (each turn fires its own `agent_end` which re-invokes the drain for the next entry).

Draining an entry SHALL release its accounted bytes from the buffer's byte total.

#### Scenario: agent_end drains one entry, leaves the rest
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }, { text: "b" }, { text: "c" }]`
- **AND** `ctx.isIdle()` returns true AND `ctx.hasPendingMessages()` returns false
- **AND** `agent_end` event fires
- **THEN** the bridge SHALL `shift` the "a" entry from `bridgeFollowUp`, leaving the "b" and "c" entries
- **AND** the bridge SHALL emit `queue_update` whose `followUp` texts are `["b", "c"]`
- **AND** the bridge SHALL call `pi.sendUserMessage("a")` with NO deliverAs option
- **AND** the bridge SHALL return without touching "b" or "c"

#### Scenario: Drain preserves image attachments
- **WHEN** `bridgeFollowUp` is `[{ text: "describe", images: [PNG] }]`
- **AND** the drain gates pass and `agent_end` fires
- **THEN** the bridge SHALL call `pi.sendUserMessage` with a content array containing `{ type: "text", text: "describe" }` and `{ type: "image", data: <PNG data>, mimeType: "image/png" }`
- **AND** the call SHALL pass NO send options
- **AND** the resulting agent turn SHALL receive the image via pi's standard image handling

#### Scenario: Text-only entry sends a bare string, not a one-element content array
- **WHEN** `bridgeFollowUp` is `[{ text: "plain" }]`
- **AND** the drain gates pass
- **THEN** the bridge SHALL call `pi.sendUserMessage("plain")` with a string argument
- **AND** the call SHALL pass NO send options

#### Scenario: Pop is observable BEFORE the pi.sendUserMessage call
- **WHEN** Vitest spies record the order of `bridgeFollowUp.shift` and `pi.sendUserMessage` calls
- **THEN** the `shift` call SHALL appear in the call log BEFORE the `sendUserMessage` call

#### Scenario: pi.sendUserMessage throws — entry is lost, not re-queued
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]`
- **AND** `pi.sendUserMessage` throws synchronously
- **AND** `agent_end` fires triggering drain
- **THEN** the bridge SHALL log a warning containing "drainFollowupQueue" and "entry lost"
- **AND** `bridgeFollowUp` SHALL remain `[]` (the entry is NOT re-pushed)
- **AND** the next `agent_end` SHALL find an empty buffer and no-op

#### Scenario: Draining an image-bearing entry releases its bytes
- **WHEN** `bridgeFollowUp` holds one entry carrying 5 MiB of image data
- **AND** the drain ships that entry
- **THEN** the buffer's accounted byte total SHALL drop by that entry's size
- **AND** a subsequent send of comparable size SHALL be admitted

#### Scenario: Idle retry succeeds within bounded window
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]`
- **AND** `agent_end` fires while `ctx.isIdle()` still returns false (transition window)
- **THEN** the drain SHALL schedule itself via `setTimeout(_, 100)` and retry
- **AND** the buffer SHALL remain unchanged during the retry window
- **AND** within ~2s (20 retries), `ctx.isIdle()` SHALL return true and the drain SHALL proceed

#### Scenario: Idle retry exhausts bounded window
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]`
- **AND** `ctx.isIdle()` continues to return false for >2s after `agent_end`
- **THEN** the drain SHALL log `"drainFollowupQueue: pi never idled after 2s; giving up"`
- **AND** the entry SHALL remain in `bridgeFollowUp` (visible to user; next agent_end will retry)

#### Scenario: TUI coexistence — bridge waits for pi to drain its own queue first
- **WHEN** `bridgeFollowUp` is `[{ text: "dashboard-msg" }]`
- **AND** `pi.hasPendingMessages()` returns true (TUI-queued follow-up still pending in pi)
- **AND** `agent_end` fires
- **THEN** the bridge SHALL NOT drain its own buffer
- **AND** `bridgeFollowUp` SHALL remain unchanged
- **AND** on a subsequent `agent_end` after pi has drained, `hasPendingMessages()` returns false and the bridge drains the entry

#### Scenario: Re-entrancy lock prevents double-drain
- **WHEN** the drain function is mid-execution for entry "a"
- **AND** a second `agent_end` event fires synchronously (re-entrant)
- **THEN** the second invocation SHALL early-return without popping
- **AND** the original drain SHALL complete normally
- **AND** a subsequent non-re-entrant `agent_end` SHALL drain "b"

### Requirement: Per-entry follow-up mutation mutates ONLY the bridge buffer

The bridge SHALL accept the following browser-to-server messages and mutate `bridgeFollowUp` locally + emit `queue_update`. The bridge SHALL NOT call `pi.sendUserMessage`, `pi.clear*Queue`, or any other pi method as part of handling these messages:

- `edit_followup_entry { sessionId, index, text }` — replaces the TEXT of `bridgeFollowUp[index]` and SHALL preserve that entry's existing `images` unchanged. The message SHALL NOT carry an `images` field: under the count-only wire projection the client never holds the image bytes, so no producer could populate it.
- `remove_followup_entry { sessionId, index }` — splices `bridgeFollowUp[index]`, discarding its images.
- `promote_followup_entry { sessionId, index }` — moves `bridgeFollowUp[index]` to position 0 via splice + unshift, carrying its images with it. Silent no-op when `index <= 0`.
- `clear_followup_entries { sessionId, indices }` — splices selected entries (when `indices: number[]`, sorted descending to avoid index drift) OR empties the buffer (when `indices: "all"`), discarding their images.

There are exactly FOUR such handlers.

An `edit_followup_entry` whose replacement text would push the buffer past the aggregate byte ceiling SHALL be refused: the entry SHALL be left unchanged and the bridge SHALL emit `command_feedback { command: "edit_followup_entry", status: "error" }` naming the byte ceiling. Growth through the inline editor is an admission path like any other.

Out-of-range indices SHALL cause the handler to emit `command_feedback { command: <type>, status: "error", message: "Index out of range" }`. No partial mutation occurs.

#### Scenario: Edit mutates buffer only, never touches pi
- **WHEN** `bridgeFollowUp` is `[{ text: "alpha" }, { text: "beta" }, { text: "gamma" }]`
- **AND** the bridge receives `edit_followup_entry { index: 1, text: "BETA" }`
- **THEN** `bridgeFollowUp` texts SHALL become `["alpha", "BETA", "gamma"]`
- **AND** the bridge SHALL emit `queue_update` reflecting those texts
- **AND** the bridge SHALL NOT call `pi.sendUserMessage`, `pi.clearSteeringQueue`, `pi.clearFollowUpQueue`, or any other pi method

#### Scenario: Edit preserves the entry's images
- **WHEN** `bridgeFollowUp` is `[{ text: "describe", images: [PNG] }]`
- **AND** the bridge receives `edit_followup_entry { index: 0, text: "describe in detail" }`
- **THEN** `bridgeFollowUp[0]` SHALL be `{ text: "describe in detail", images: [PNG] }`
- **AND** the emitted `queue_update` SHALL still report `imageCount: 1` for that entry
- **AND** a subsequent drain SHALL deliver the PNG

#### Scenario: Remove splices a single entry
- **WHEN** `bridgeFollowUp` is `[{ text: "alpha" }, { text: "beta" }, { text: "gamma" }]`
- **AND** the bridge receives `remove_followup_entry { index: 0 }`
- **THEN** `bridgeFollowUp` texts SHALL become `["beta", "gamma"]`
- **AND** the bridge SHALL emit `queue_update`

#### Scenario: Promote moves entry to head
- **WHEN** `bridgeFollowUp` is `[{ text: "alpha" }, { text: "beta" }, { text: "gamma" }]`
- **AND** the bridge receives `promote_followup_entry { index: 2 }`
- **THEN** `bridgeFollowUp` texts SHALL become `["gamma", "alpha", "beta"]`
- **AND** the bridge SHALL emit `queue_update`

#### Scenario: Promote carries images with the moved entry
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }, { text: "b", images: [PNG] }]`
- **AND** the bridge receives `promote_followup_entry { index: 1 }`
- **THEN** `bridgeFollowUp[0]` SHALL be `{ text: "b", images: [PNG] }`
- **AND** the emitted `queue_update` SHALL report `imageCount: 1` at position 0 and `0` at position 1

#### Scenario: Promote on index 0 is a silent no-op
- **WHEN** `bridgeFollowUp` is `[{ text: "alpha" }, { text: "beta" }]`
- **AND** the bridge receives `promote_followup_entry { index: 0 }`
- **THEN** `bridgeFollowUp` SHALL remain unchanged
- **AND** the bridge SHALL NOT emit `queue_update`

#### Scenario: Clear all empties the buffer
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }, { text: "b" }, { text: "c" }]`
- **AND** the bridge receives `clear_followup_entries { indices: "all" }`
- **THEN** `bridgeFollowUp` SHALL become `[]`
- **AND** the bridge SHALL emit `queue_update { followUp: [] }`

#### Scenario: Clear specific indices splices selected entries
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }]`
- **AND** the bridge receives `clear_followup_entries { indices: [0, 2] }`
- **THEN** the bridge SHALL splice in descending order (2 first, then 0) to avoid index drift
- **AND** `bridgeFollowUp` texts SHALL become `["b", "d"]`
- **AND** the bridge SHALL emit `queue_update` exactly once

#### Scenario: Out-of-range index produces command_feedback error
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]`
- **AND** the bridge receives `edit_followup_entry { index: 5, text: "x" }`
- **THEN** the bridge SHALL NOT mutate `bridgeFollowUp`
- **AND** the bridge SHALL emit `command_feedback { command: "edit_followup_entry", status: "error", message: "Index out of range" }`
- **AND** the bridge SHALL NOT emit `queue_update`

#### Scenario: Edit that would breach the byte ceiling is refused
- **WHEN** the buffer holds entries totalling 31 MiB, one of which has the text "short"
- **AND** the bridge receives an `edit_followup_entry` replacing "short" with text large enough to push the total past 32 MiB
- **THEN** the entry SHALL remain unchanged
- **AND** the bridge SHALL emit `command_feedback { command: "edit_followup_entry", status: "error" }` naming the byte ceiling
- **AND** the bridge SHALL NOT emit `queue_update`

### Requirement: TUI compatibility — dashboard-buffered follow-up is invisible to TUI; symmetric

The dashboard's bridge SHALL hold dashboard-originated follow-up entries exclusively in `bridgeFollowUp`, never mirroring them into pi's `Agent.followUpQueue` until the drain loop ships them. Therefore:

1. TUI users SHALL NOT see dashboard-queued follow-ups in pi-TUI's footer widget (pi has no knowledge of the bridge buffer).
2. TUI users pressing `alt+up` (which calls `agent.clearAllQueues()`) SHALL clear pi's queues only; `bridgeFollowUp` SHALL remain untouched.
3. Dashboard users SHALL NOT see TUI-queued follow-ups in the dashboard `QueuePanel` (the shadow only tracks bridge-originated sends).
4. Both surfaces' messages SHALL still execute. At each `agent_end`, pi drains its own queue first (TUI items); the bridge drain runs after via the TUI-coexistence gate (`hasPendingMessages` returning false).

The bridge buffer is in-memory and SHALL NOT persist across bridge restart. On `/reload`, dashboard restart, or pi crash, `bridgeFollowUp` initializes empty; any pending dashboard-queued items are lost.

#### Scenario: Mixed TUI + dashboard queue — both drain in order
- **WHEN** TUI sends follow-up "look at logs" via `pi.sendUserMessage(_, {deliverAs:"followUp"})` (enters pi's queue)
- **AND** dashboard sends follow-up "run tests" (enters `bridgeFollowUp`)
- **AND** the agent finishes its current turn, firing `agent_end`
- **THEN** pi SHALL drain its own queue first — "look at logs" runs as a continuation turn
- **AND** a subsequent `agent_end` fires after that turn
- **AND** `pi.hasPendingMessages()` now returns false; the bridge drain fires `pi.sendUserMessage("run tests")` for the dashboard item
- **AND** both messages execute in order: TUI item first, dashboard item second

#### Scenario: TUI alt+up does not clear dashboard buffer
- **WHEN** TUI has queued "X" in pi's queue
- **AND** dashboard has buffered "Y" in `bridgeFollowUp`
- **AND** the TUI user presses alt+up
- **THEN** `pi.Agent.followUpQueue` SHALL be cleared (text "X" returns to TUI editor)
- **AND** `bridgeFollowUp` SHALL remain `["Y"]`
- **AND** the dashboard `QueuePanel` SHALL continue showing "Y"

#### Scenario: Bridge restart loses bridgeFollowUp
- **WHEN** dashboard has buffered "important task" in `bridgeFollowUp`
- **AND** the bridge process restarts (e.g. `/reload`)
- **THEN** `bridgeFollowUp` SHALL initialize to `[]` on the new bridge instance
- **AND** "important task" SHALL be lost (user must re-type)
- **AND** the QueuePanel SHALL render nothing for that session until the user re-queues

### Requirement: Steer queue is permanently pi-owned + display-only — no bridge-owned-steer

The steer queue SHALL remain pi-owned for the indefinite future. The dashboard SHALL NOT introduce a bridge-owned steer buffer, steer mutation surface, or per-steer-entry edit/remove/promote/pull affordances. Steer entries render inline in `ChatView` as ghost user-message bubbles (not in the follow-up `QueuePanel`).

**Rationale**: Steer drains every 1-15 seconds at every `turn_end`. The window in which a user could meaningfully cancel/edit a steer entry is too short to justify the UI surface. Pi-TUI also has no per-steer edit. This is a permanent design decision, not a tracked future change.

The bridge SHALL track `bridgeSteering` as a SHADOW (mirrors pi's `Agent.steeringQueue`) via:

- `recordSteerSent(text)`: bridge-originated steer pushes append to `bridgeSteering` only when `getBridgeState().isAgentStreaming === true` (capture-before-send pattern; mid-flight `pi.sendUserMessage` flips `isAgentStreaming` synchronously on idle sends, so we capture pre-send to avoid false chips).
- Drain-by-`message_start`-matcher: when pi delivers a queued steer at `turn_end`, the matching text is spliced from `bridgeSteering` (FIFO first-occurrence removal).

The dashboard SHALL NOT expose any client-side action that mutates `bridgeSteering` or pi's steer queue. The Stop button calls `cachedCtx.abort()` only — pi's steer queue persists across abort by design.

#### Scenario: No steer mutation messages exist in the wire protocol
- **WHEN** the wire protocol (`packages/shared/src/browser-protocol.ts`) is examined for steer-mutation message types
- **THEN** there SHALL be no `clear_steering_queue`, `edit_steering_entry`, `remove_steering_entry`, or `promote_steering_entry` types
- **AND** the bridge SHALL NOT handle any such messages

#### Scenario: Steer renders inline as ghost bubbles, never in QueuePanel
- **WHEN** `pendingQueues.steering` is `["focus on X"]`
- **THEN** `ChatView` SHALL render "focus on X" as a ghost user-message bubble at the bottom of the message list with a STEERING header + animated spinner
- **AND** `QueuePanel` SHALL NOT render any steer chip or steer section

#### Scenario: Stop does NOT clear pi's steer queue
- **WHEN** `pendingQueues.steering` is `["a", "b"]`
- **AND** the user clicks Stop
- **THEN** the bridge SHALL call `cachedCtx.abort()` only
- **AND** the bridge SHALL NOT call `pi.clearSteeringQueue` (it's not on the ExtensionAPI; the call is deleted from this codebase)
- **AND** pi's steer queue SHALL persist; the entries will drain at the next `turn_end` of the next turn (when the user re-prompts)

### Requirement: Pi ExtensionAPI does not expose queue-mutation methods

The bridge SHALL NOT call `pi.clearSteeringQueue()`, `pi.clearFollowUpQueue()`, or `pi.clearAllQueues()` from any code path. These methods exist on the inner `pi-agent-core` Agent class but are NOT exposed on the ExtensionAPI handed to extensions (verified through pi-coding-agent 0.76.0 at `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:1076-1099`).

If a future pi release adds these methods to the ExtensionAPI, a separate change MAY OPTIONALLY introduce them as an optimization (e.g. "explicit flush of TUI items before bridge drain"). The dashboard's correctness SHALL NOT depend on their availability; the bridge-owned model is correct without them.

#### Scenario: Codebase contains no `pi.clear*Queue` call expressions
- **WHEN** `grep -nE 'pi\.clearFollowUpQueue\(|pi\.clearSteeringQueue\(|pi\.clearAllQueues\(' packages/extension/src` runs
- **THEN** the output SHALL contain zero call expressions (only comment markers that reference the deletion are acceptable)

#### Scenario: Bridge ignores the OLD deleted browser message types
- **WHEN** the bridge receives any of: `clear_steering_queue`, `clear_followup_slot`, `edit_followup_slot`, `edit_followup_entry` (with the OLD pi-mutation semantics), `remove_followup_entry` (with the OLD semantics), `promote_followup_entry` (with the OLD semantics)
- **AND** these arrive through a stale client or test injection
- **THEN** the bridge router SHALL NOT have a `case` arm for any of them
- **AND** the message SHALL be silently dropped (fall through to the default no-op arm)
- **AND** no `pi.*` method SHALL be called
- **AND** no `queue_update` SHALL be emitted
- **NOTE**: `edit_followup_entry`, `remove_followup_entry`, `promote_followup_entry` are RE-INTRODUCED with NEW bridge-buffer-only semantics in the ADDED requirements above. The negative-assertion test (`bridge-no-queue-mutation.test.ts`) MUST iterate only the names that remain permanently deleted: `clear_steering_queue`, `clear_followup_slot`, `edit_followup_slot`.

### Requirement: Follow-up display chip caps rendered height and scrolls on overflow

The `queue-chip-followup` display element in `QueuePanel` SHALL cap its rendered height and scroll internally when entry text exceeds that height, rather than growing unbounded with the entry length. The cap SHALL match the project's existing capped-content idiom (`max-h-80 overflow-auto`, 320px) used across tool renderers. The cap SHALL NOT apply to edit mode (`queue-followup-editor`), which is already height-gated by its `rows` limit.

#### Scenario: short entry renders at natural height
- **WHEN** `pendingQueues.followUp` contains a single short entry
- **THEN** `queue-chip-followup` SHALL render at its natural content height with no scrollbar

#### Scenario: oversized entry caps height and scrolls
- **WHEN** a follow-up entry's rendered text exceeds the chip height cap
- **THEN** `queue-chip-followup` SHALL constrain its height to the cap (`max-h-80`)
- **AND** SHALL expose a vertical scrollbar (`overflow-auto`) for the overflow
- **AND** SHALL NOT push the chat input or surrounding layout off-screen

#### Scenario: edit mode height-gating unchanged
- **WHEN** the user opens the inline editor (`queue-followup-editor`)
- **THEN** the editor SHALL remain gated by its existing `rows` limit
- **AND** the display chip's `max-h-80 overflow-auto` cap SHALL NOT alter editor behavior

### Requirement: Follow-up buffer enforces an aggregate byte ceiling

The bridge SHALL bound `bridgeFollowUp` by total retained bytes in addition to the existing entry-count cap. The ceiling SHALL default to `FOLLOWUP_BUFFER_MAX_BYTES = 32 * 1024 * 1024` (32 MiB) per session.

The ceiling SHALL be readable from an injected value rather than compared against a hardcoded literal at the admission site, so that boundary behaviour can be exercised with a small ceiling without allocating megabyte payloads. Overriding the ceiling SHALL change only the threshold — never the admission, refusal, or feedback logic.

An entry's size SHALL be computed as `Buffer.byteLength(text)` plus the length of each image's inline base64 bytes. Image `data` is base64, so its string length is exactly its byte count; `text` is measured with `byteLength` because `String.length` counts UTF-16 code units and under-counts non-Latin-1 text. The implementation SHALL NOT use `JSON.stringify` to measure.

The inline bytes SHALL be read through the canonical accessor `imageBlockData` (`packages/shared/src/image-block.ts`), so that an image block in EITHER accepted shape — flat pi `{ type, data, mimeType }` or nested Anthropic `{ type, source: { media_type, data } }` — is sized by its real bytes. A direct `.data` property read sizes a nested-shape block at zero and admits an unbounded hold past the ceiling.

#### Scenario: A nested-shape image is sized by its real bytes
- **WHEN** the buffer is empty and its ceiling is 1 KiB
- **AND** a follow-up send carries one image in the nested shape `{ type: "image", source: { type: "base64", media_type: "image/png", data: <4 KiB of base64> } }`
- **THEN** the entry SHALL be sized at its real byte count, not zero
- **AND** the send SHALL be refused by the byte ceiling

The total SHALL be **recomputed from the live entries at each admission check**, NOT maintained as a running counter. The buffer is mutated from many sites (push, system push, drain, edit, remove, promote, clear, matcher splice, session reset, and any future site); a counter that misses one decrement mis-enforces the ceiling permanently and silently. Recomputation over at most 20 entries makes drift structurally impossible and means every present and future removal path releases bytes without knowing the budget exists.

A push SHALL be admitted only when the resulting total would not exceed the ceiling. On refusal the bridge SHALL:

- NOT append the entry, in whole or in part,
- NOT strip images from the entry to make it fit,
- emit `command_feedback { command: "send_prompt", status: "error" }` identifying the byte ceiling as the cause.

The bridge SHALL NOT evict previously accepted entries to admit a new one. A prompt the user has already seen queued SHALL NOT disappear without their action.

Removing, clearing, or draining entries SHALL release their bytes, allowing subsequent sends.

#### Scenario: Overriding the ceiling changes only the threshold
- **WHEN** the buffer is constructed with a ceiling of 1 KiB
- **AND** a send whose entry size exceeds 1 KiB is attempted
- **THEN** the send SHALL be refused exactly as it would be at the 32 MiB default
- **AND** the refusal SHALL emit the same `command_feedback { status: "error" }` shape

#### Scenario: Send within the ceiling is admitted
- **WHEN** the buffer holds 4 MiB of entries
- **AND** the user sends a follow-up carrying 2 MiB of images
- **THEN** the entry SHALL be appended
- **AND** the accounted total SHALL become approximately 6 MiB

#### Scenario: Send that would exceed the ceiling is refused with feedback
- **WHEN** the buffer holds 30 MiB of entries
- **AND** the user sends a follow-up carrying 4 MiB of images
- **THEN** the bridge SHALL NOT append the entry
- **AND** the accounted total SHALL remain approximately 30 MiB
- **AND** the bridge SHALL emit `command_feedback { command: "send_prompt", status: "error" }` naming the byte ceiling

#### Scenario: An entry larger than the whole ceiling is refused, not truncated
- **WHEN** the buffer is empty
- **AND** the user sends a follow-up whose images total 40 MiB
- **THEN** the bridge SHALL refuse the entry entirely
- **AND** the bridge SHALL NOT append a text-only or image-stripped version of it
- **AND** the bridge SHALL emit `command_feedback { command: "send_prompt", status: "error" }`

#### Scenario: Ceiling is enforced independently of the entry-count cap
- **WHEN** the buffer holds 3 entries totalling 31 MiB
- **AND** the user sends a follow-up carrying 2 MiB of images
- **THEN** the send SHALL be refused on the byte ceiling despite the count being far below 20

#### Scenario: Removing an entry releases its bytes
- **WHEN** the buffer holds 31 MiB and a further send has just been refused
- **AND** the user removes an entry accounting for 10 MiB
- **AND** the user retries the refused send
- **THEN** the retried send SHALL be admitted

#### Scenario: The accounted total is derived, not accumulated
- **WHEN** entries are added and removed through any combination of push, drain, remove, promote, clear, and session reset
- **THEN** the admission check SHALL reflect the sum over the entries actually present at that moment
- **AND** no mutation path SHALL be able to leave the accounting inconsistent with the buffer contents

### Requirement: A refused system follow-up reports under its own command name

`enqueueSystemFollowup` (the plugin-originated path) SHALL enforce the same entry-count cap and byte ceiling as a user send. On refusal it SHALL emit `command_feedback { command: "enqueue_followup", status: "error" }` rather than borrowing `send_prompt`, so a programmatic refusal is not misattributed to a user action. A refused system nudge SHALL NOT be silently dropped.

#### Scenario: System follow-up refused at the entry cap
- **WHEN** `bridgeFollowUp` holds 20 entries
- **AND** a plugin enqueues a system follow-up via `dashboard:enqueue-followup`
- **THEN** the entry SHALL NOT be appended
- **AND** the bridge SHALL emit `command_feedback { command: "enqueue_followup", status: "error" }`

#### Scenario: System follow-up refused at the byte ceiling
- **WHEN** the buffer is within a few bytes of the 32 MiB ceiling
- **AND** a plugin enqueues a system follow-up large enough to breach it
- **THEN** the entry SHALL NOT be appended
- **AND** the bridge SHALL emit `command_feedback { command: "enqueue_followup", status: "error" }`

### Requirement: A dropped image is reported, never silently omitted

When image validation rejects an attachment (unsupported `mimeType`, missing or non-string `data`, or a non-object entry), the bridge SHALL emit `command_feedback { status: "error" }` identifying how many attachments were dropped and why. A validation drop SHALL NOT be reported only to the process log.

This applies wherever validation runs — the idle/steer send path and the follow-up buffer path share one validation implementation.

Validation SHALL read an image's mime through the canonical accessor `imageBlockMime` (`packages/shared/src/image-block.ts`), so that a block in either accepted shape is judged against the allow-list on its real mime. A block whose mime is carried nested (`source.media_type`) SHALL NOT be rejected as untyped. The allow-list itself (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) is unchanged and SHALL NOT be widened by this change.

#### Scenario: A nested-shape image is not dropped as invalid
- **WHEN** the user sends a follow-up while streaming with one image whose mime is carried as `source.media_type: "image/png"`
- **THEN** the buffered entry SHALL carry that image
- **AND** the emitted `queue_update` SHALL report `imageCount: 1`
- **AND** the bridge SHALL NOT emit any validation `command_feedback`

#### Scenario: One bad attachment among several is reported
- **WHEN** the user sends a follow-up while streaming with three images, one of which has `mimeType: "image/svg+xml"`
- **THEN** the buffered entry SHALL carry the two valid images
- **AND** the emitted `queue_update` SHALL report `imageCount: 2` for that entry
- **AND** the bridge SHALL emit `command_feedback { status: "error" }` stating that one attachment was dropped as an unsupported type

#### Scenario: All attachments valid produces no feedback
- **WHEN** the user sends a follow-up with two images of supported types
- **THEN** the entry SHALL carry both images
- **AND** the bridge SHALL NOT emit any validation `command_feedback`

### Requirement: Queued follow-up chip indicates attached images

`QueuePanel` SHALL render an attachment indicator, carrying `data-testid="queue-followup-attachments"`, on a follow-up chip whose entry reports `imageCount > 0`, showing the count. The chip SHALL NOT render image thumbnails or previews — the bytes are not available to the client by design.

A chip whose entry reports `imageCount: 0` SHALL render exactly as before, with no indicator.

#### Scenario: Chip shows an indicator for an image-bearing entry
- **WHEN** `pendingQueues.followUp` is `[{ text: "describe", imageCount: 2 }]`
- **THEN** the chip SHALL display the text "describe"
- **AND** `queue-followup-attachments` SHALL be present and show the count 2
- **AND** the chip SHALL NOT render any image thumbnail

#### Scenario: Text-only chip is unchanged
- **WHEN** `pendingQueues.followUp` is `[{ text: "plain", imageCount: 0 }]`
- **THEN** the chip SHALL display the text "plain"
- **AND** `queue-followup-attachments` SHALL NOT be present in the DOM

#### Scenario: Indicator survives an edit
- **WHEN** a chip displays an attachment indicator for an image-bearing entry
- **AND** the user edits that entry's text and submits
- **THEN** the updated chip SHALL still present `queue-followup-attachments` with the same count

### Requirement: Client tolerates legacy string follow-up entries

The client SHALL normalise each `pendingQueues.followUp` element on read, accepting either the current `{ text, imageCount }` object or a bare `string` (treated as `{ text: <value>, imageCount: 0 }`).

This guards the window in which an already-loaded browser tab running pre-change client code receives a post-change payload, or the reverse. Without it a stale tab renders `[object Object]` in the chip.

#### Scenario: Object entry renders normally
- **WHEN** the client receives `pendingQueues.followUp = [{ text: "hello", imageCount: 1 }]`
- **THEN** the chip SHALL render "hello" with `queue-followup-attachments` showing 1

#### Scenario: Legacy string entry renders without an indicator
- **WHEN** the client receives `pendingQueues.followUp = ["hello"]`
- **THEN** the chip SHALL render "hello"
- **AND** `queue-followup-attachments` SHALL NOT be present
- **AND** no `[object Object]` text SHALL appear

