## MODIFIED Requirements

### Requirement: Typed-during-streaming prompts are forwarded to pi's native queues

When the bridge receives a `send_prompt` message AND `getBridgeState().isAgentStreaming === true` for the target session AND the prompt is not a slash, bash, compact, reload, new, model, or mgmt command, the bridge SHALL route based on `msg.delivery` — follow-up goes to the bridge-owned buffer, steer goes to pi's queue:

- If `delivery === "followUp"` (or absent — backward-compat default), the bridge SHALL push a `{ text, images? }` entry into its in-memory `bridgeFollowUp` buffer AND emit `queue_update { sessionId, steering, followUp }` carrying the entry VIEWS (`{ text, imageCount }`), never image bytes. The bridge SHALL NOT call `pi.sendUserMessage(text, { deliverAs: "followUp" })`. Pi does not receive the message until the drain loop ships it later (see "Bridge follow-up drain loop runs on agent_settled").

- If `delivery === "steer"`, the bridge SHALL call `pi.sendUserMessage(text, { deliverAs: "steer" })` directly. Steer remains pi-owned; the bridge tracks shadow steering via `recordSteerSent` + drain-by-`message_start`-matcher (unchanged from prior architecture).

The bridge SHALL NOT call `pi.clearSteeringQueue()`, `pi.clearFollowUpQueue()`, or `pi.clearAllQueues()` from any code path. None of these methods are exposed on pi's ExtensionAPI through pi 1.3.0 (re-verified: `dist/core/extensions/types.d.ts` declares none of them).

When `getBridgeState().isAgentStreaming === false` (idle session), the bridge SHALL call `pi.sendUserMessage(text, { deliverAs })` directly, with `deliverAs` defaulting to `"followUp"`. pi ignores `deliverAs` when idle and starts a fresh turn; when pi is already busy (a run starting, pi ≥ 1.2.0, before the bridge sees `agent_start`), pi queues the message natively instead of rejecting it. Idle sends bypass the buffer entirely (no chip appears).

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
- **THEN** the bridge SHALL call `pi.sendUserMessage("hi", { deliverAs: "followUp" })`
- **AND** the bridge SHALL NOT touch `bridgeFollowUp` or `bridgeSteering`

### Requirement: Bridge maintains shadow steering and follow-up queues

Pi's ExtensionAPI does not forward `queue_update` events to extensions (re-verified through pi 1.3.0: neither `types.d.ts` nor `runner.js` mentions `queue_update`). The bridge SHALL maintain two distinct per-session in-memory structures with different ownership semantics:

- **`bridgeSteering: string[]` (pi-OWNED + SHADOW)** — mirrors pi's `Agent.steeringQueue`. Mutated only by `recordSteerSent` (on bridge-originated steer sends) + drain-by-`message_start`-matcher (when pi delivers a queued steer entry, the matching text is spliced).
- **`bridgeFollowUp: FollowUpEntry[]` (BRIDGE-OWNED BUFFER)** — authoritative store for dashboard-originated follow-up entries while the agent is streaming, where `FollowUpEntry = { text: string; images?: ImageContent[] }`. Pi never sees these entries until the drain loop ships them on `agent_settled`. Mutated by `bufferFollowupSend` (on push), `enqueueSystemFollowup` (on system push), `drainFollowupQueue` (on pop), and the four mutation handlers (`edit_followup_entry`, `remove_followup_entry`, `promote_followup_entry`, `clear_followup_entries`).

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

### Requirement: TUI compatibility — dashboard-buffered follow-up is invisible to TUI; symmetric

The dashboard's bridge SHALL hold dashboard-originated follow-up entries exclusively in `bridgeFollowUp`, never mirroring them into pi's `Agent.followUpQueue` until the drain loop ships them. Therefore:

1. TUI users SHALL NOT see dashboard-queued follow-ups in pi-TUI's footer widget (pi has no knowledge of the bridge buffer).
2. TUI users pressing `alt+up` (which calls `agent.clearAllQueues()`) SHALL clear pi's queues only; `bridgeFollowUp` SHALL remain untouched.
3. Dashboard users SHALL NOT see TUI-queued follow-ups in the dashboard `QueuePanel` (the shadow only tracks bridge-originated sends).
4. Both surfaces' messages SHALL still execute. Pi drains its own queue (TUI items) inside the run, continuing while it holds queued messages, before it settles; the bridge drain runs after `agent_settled` via the TUI-coexistence gate (`hasPendingMessages` returning false).

The bridge buffer is in-memory and SHALL NOT persist across bridge restart. On `/reload`, dashboard restart, or pi crash, `bridgeFollowUp` initializes empty; any pending dashboard-queued items are lost.

#### Scenario: Mixed TUI + dashboard queue — both drain in order
- **WHEN** TUI sends follow-up "look at logs" via `pi.sendUserMessage(_, {deliverAs:"followUp"})` (enters pi's queue)
- **AND** dashboard sends follow-up "run tests" (enters `bridgeFollowUp`)
- **AND** the agent finishes its current turn
- **THEN** pi SHALL drain its own queue first — "look at logs" runs as a continuation within the same run
- **AND** `agent_settled` fires once after that continuation
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

### Requirement: Drained queued user message renders AFTER the preceding assistant message in chat

When a queued user message is drained at either boundary (steer by pi at `turn_end`; a dashboard follow-up by the bridge drain after `agent_settled`), the resulting user `message_start` event SHALL arrive on the wire AFTER the preceding assistant `message_end` event. The client reducer SHALL therefore append the drained user bubble to `state.messages[]` AFTER the assistant's final response, not before it.

This invariant applies to BOTH drain boundaries:

- **Steer drain** at `turn_end` (Enter while streaming)
- **Follow-up drain** after `agent_settled` (Alt+Enter while streaming): the bridge drain ships the entry from a `setTimeout(_, 0)` scheduled by its `agent_settled` handler, so the assistant `message_end` deferral (scheduled earlier) is already queued ahead of it. Follow-ups queued natively in pi (e.g. from the TUI) are drained by pi inside the run, before `agent_end`.

At the steer boundary pi emits four events synchronously back-to-back in this order:

1. `message_end` (assistant — the final response of the just-completed turn)
2. `turn_end` (the drain boundary)
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
- **AND** pi emits `agent_end` and then `agent_settled`, and the bridge drain ships `"asd"` as a fresh turn
- **THEN** on the wire, `message_end` (assistant `"weather report"`) SHALL precede `message_start` (user `"asd"`), and `message_start` (user `"asd"`) SHALL follow `agent_settled`
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
- **WHEN** pi's steer queue contains `["a", "b"]` at the `turn_end` boundary
- **AND** pi drains both entries in order
- **THEN** the wire order SHALL be: assistant `message_end`, user `message_start "a"`, user `message_end "a"`, user `message_start "b"`, user `message_end "b"`
- **AND** the chat SHALL render the assistant message first, then `"a"`, then `"b"`

#### Scenario: Idle user send is unaffected by the deferral
- **WHEN** the user sends a prompt on an idle session
- **AND** no `message_end` is pending in the timer queue
- **THEN** the user `message_start` SHALL still be deferred via `setTimeout(0)` (uniform handling)
- **AND** the message SHALL appear in chat after exactly one macrotask delay (visually instant)

## REMOVED Requirements

### Requirement: Bridge follow-up drain loop runs on agent_end with pop-before-send invariant
**Reason**: The trigger moves from `agent_end` to `agent_settled`, and the idle-retry gate (100 ms × 20) together with its two scenarios is dropped. `agent_end` arrives before pi goes idle, which is the only reason the retry loop existed. pi (≥ 1.1.0, verified on 1.3.0) clears `_isAgentRunActive` before emitting `agent_settled` (`agent-session.js:684-691`), so the session is idle when the drain runs.
**Migration**: Replaced by "Bridge follow-up drain loop runs on agent_settled with pop-before-send invariant". The pop-before-send, emit-before-send, fresh-turn send, catch-and-drop, image, byte-release, TUI-coexistence and re-entrancy invariants carry over unchanged.

## ADDED Requirements

### Requirement: Bridge follow-up drain loop runs on agent_settled with pop-before-send invariant

The bridge SHALL schedule `drainFollowupQueue()` via `setTimeout(_, 0)` from its `agent_settled` handler, and SHALL NOT schedule it from `agent_end`. pi emits `agent_settled` once per run, after any auto-retry attempts and queued-message continuations, and only after it has cleared its active-run state. The `setTimeout` lets the send observe a settled, idle session instead of being deferred by pi into its settle-emission queue.

The drain function SHALL enforce the following invariants in order:

1. **Re-entrancy lock**: a boolean `isDraining` SHALL prevent overlapping drain frames. Set true after gates pass; cleared in `finally`. Re-entrant calls early-return.
2. **Empty-buffer gate**: if `bridgeFollowUp.length === 0`, drain bails immediately.
3. **TUI-coexistence gate**: if `ctx.hasPendingMessages()` returns true, drain bails.
4. **Single idle check**: if `ctx.isIdle()` returns false (a run has already started, e.g. a TUI prompt or another extension's settle action), drain SHALL return without popping and without re-scheduling itself. The next `agent_settled` drains.
5. **Pop FIRST**: `bridgeFollowUp.shift()` captures the front entry BEFORE any pi call.
6. **Emit BEFORE send**: `emitQueueUpdate()` SHALL fire reflecting the popped state BEFORE calling pi.
7. **Fresh-turn send, NO deliverAs**: the drain SHALL call `pi.sendUserMessage(content)` with NO options, where `content` is the entry's text alone when it carries no images, or a content array `[{type:"text"}, {type:"image"}...]` when it does.
8. **Catch + drop on pi error**: any synchronous exception from `pi.sendUserMessage` SHALL be caught, logged as `console.warn` containing "drainFollowupQueue" and "entry lost", and the entry SHALL NOT be re-pushed. pi's extension `sendUserMessage` is fire-and-forget: an asynchronous rejection (e.g. compaction started) goes to pi's extension error channel, not to this catch, so it is not logged here.

The drain SHALL handle at most one entry per `agent_settled`; multiple queued entries drain across successive runs in FIFO order. Draining an entry SHALL release its accounted bytes. A system follow-up (`enqueueSystemFollowup`) SHALL keep scheduling the same drain via `setTimeout(_, 0)`: shipped at once when idle, otherwise by the next `agent_settled`.

#### Scenario: agent_settled drains one entry, leaves the rest
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }, { text: "b" }, { text: "c" }]`
- **AND** `ctx.isIdle()` returns true AND `ctx.hasPendingMessages()` returns false
- **AND** `agent_settled` fires
- **THEN** the bridge SHALL `shift` the "a" entry, leaving "b" and "c"
- **AND** emit `queue_update` whose `followUp` texts are `["b", "c"]`
- **AND** call `pi.sendUserMessage("a")` with NO deliverAs option

#### Scenario: agent_end alone does not drain
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]`
- **AND** `agent_end` fires and no `agent_settled` follows
- **THEN** the bridge SHALL NOT call `pi.sendUserMessage`
- **AND** `bridgeFollowUp` SHALL remain `[{ text: "a" }]`

#### Scenario: Auto-retry chain drains once, after the final attempt
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]`
- **AND** pi runs two failed attempts and a successful third, each emitting `agent_end`, then one `agent_settled`
- **THEN** the bridge SHALL call `pi.sendUserMessage("a")` exactly once, after `agent_settled`

#### Scenario: Busy at drain time — no pop, no retry loop
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]`
- **AND** `agent_settled` fires but `ctx.isIdle()` returns false when the drain runs
- **THEN** the bridge SHALL NOT pop or send
- **AND** SHALL NOT schedule a timed retry
- **AND** on the next `agent_settled` with `ctx.isIdle()` true, it SHALL send "a"

#### Scenario: An aborted run's settle drains the next entry
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]` and the user aborts the running turn
- **AND** pi emits `agent_settled` with `aborted: true`, `ctx.isIdle()` returns true and `ctx.hasPendingMessages()` returns false
- **THEN** the bridge SHALL call `pi.sendUserMessage("a")` once, as the `agent_end`-triggered drain did before

#### Scenario: Drain preserves image attachments
- **WHEN** `bridgeFollowUp` is `[{ text: "describe", images: [PNG] }]` and the drain gates pass
- **THEN** the bridge SHALL call `pi.sendUserMessage` with a content array containing `{ type: "text", text: "describe" }` and `{ type: "image", data: <PNG data>, mimeType: "image/png" }`, passing NO send options

#### Scenario: Text-only entry sends a bare string
- **WHEN** `bridgeFollowUp` is `[{ text: "plain" }]` and the drain gates pass
- **THEN** the bridge SHALL call `pi.sendUserMessage("plain")` with a string argument and NO send options

#### Scenario: Pop is observable BEFORE the pi.sendUserMessage call
- **WHEN** spies record the order of `bridgeFollowUp.shift` and `pi.sendUserMessage`
- **THEN** `shift` SHALL appear BEFORE `sendUserMessage`

#### Scenario: pi.sendUserMessage throws — entry is lost, not re-queued
- **WHEN** `bridgeFollowUp` is `[{ text: "a" }]` and `pi.sendUserMessage` throws synchronously during the drain
- **THEN** the bridge SHALL log a warning containing "drainFollowupQueue" and "entry lost"
- **AND** `bridgeFollowUp` SHALL remain `[]`

#### Scenario: Draining an image-bearing entry releases its bytes
- **WHEN** the drain ships an entry carrying 5 MiB of image data
- **THEN** the buffer's accounted byte total SHALL drop by that entry's size

#### Scenario: TUI coexistence — bridge waits for pi's own queue
- **WHEN** `bridgeFollowUp` is `[{ text: "dashboard-msg" }]` and `ctx.hasPendingMessages()` returns true at drain time
- **THEN** the bridge SHALL NOT drain, and `bridgeFollowUp` SHALL remain unchanged

#### Scenario: Re-entrancy lock prevents double-drain
- **WHEN** the drain is mid-execution for entry "a" and a second drain call arrives re-entrantly
- **THEN** the second call SHALL early-return without popping
