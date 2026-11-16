# Spec Delta

## MODIFIED Requirements

### Requirement: Server caches per-session queue state from `queue_update` events

The server SHALL maintain a per-session `pendingQueues: { steering: SteerEntryView[]; followUp: FollowUpEntryView[] }` field inside `SessionUiState`, where `FollowUpEntryView = { text: string; imageCount: number }` and `SteerEntryView = { id: string; text: string; imageCount: number }`. The field SHALL be updated whenever a `queue_update` ExtensionToServerMessage arrives from a bridge for that session. The server SHALL include `pendingQueues` in every `session_updated` broadcast and in the initial-state replay sent on browser subscribe.

The server SHALL forward `steering` and `followUp` entries verbatim and SHALL NOT inspect, rewrite, or validate their fields; a bridge older than this change sends `steering` as plain strings, which the server forwards unchanged. Image bytes SHALL NOT appear in either array.

This replaces the prior `queue.pending: PendingPrompt[]` cache, which was sourced from the deleted `queue_state` event.

#### Scenario: queue_update populates the cache
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [{ id: "1", text: "a", imageCount: 0 }], followUp: [{ text: "c", imageCount: 0 }] }`
- **THEN** the server SHALL set `SessionUiState[S].pendingQueues` to exactly that `steering` and `followUp`
- **AND** the server SHALL broadcast `session_updated` with the new value to subscribers

#### Scenario: Image-bearing entry round-trips its count
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [{ id: "2", text: "see", imageCount: 2 }], followUp: [{ text: "describe", imageCount: 2 }] }`
- **THEN** the broadcast SHALL carry `imageCount: 2` on both entries unmodified
- **AND** no image `data` field SHALL be present anywhere in the broadcast payload

#### Scenario: Empty arrays clear the cache slot
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [], followUp: [] }`
- **THEN** the server SHALL set `SessionUiState[S].pendingQueues = { steering: [], followUp: [] }`
- **AND** the server SHALL broadcast `session_updated`

#### Scenario: Reconnect replays the cached state
- **WHEN** a browser subscribes to session "S" whose `pendingQueues` is non-empty
- **THEN** the initial-state snapshot SHALL include the current `pendingQueues` value
- **AND** the client SHALL render chips for both arrays without waiting for a fresh `queue_update`

### Requirement: Capture-before-send streaming gate prevents idle-message false-chip

Pi flips `isAgentStreaming` synchronously inside `pi.sendUserMessage` on an idle session (via `agent_start` emission to the extension runner). Therefore the bridge SHALL capture `wasStreaming = isAgentStreaming` **before** any routing decision, and SHALL only add to a bridge buffer when `wasStreaming === true`.

Call sites:

- `command-handler.ts` passthrough branch: capture before routing; streaming steer → steer buffer, streaming follow-up → follow-up buffer, idle → `sendUserMessageWithImages`.
- the bridge's `sessionPrompt` fallback (slash-route follow-up/steer): same pattern.
- the bridge's `edit_followup_entry` handler: same pattern.

The internal admission into either buffer SHALL also check `isAgentStreaming` as defense-in-depth.

#### Scenario: Initial idle send produces no chip
- **WHEN** the agent is idle (`isAgentStreaming === false`)
- **AND** the bridge receives `send_prompt { text: "hello", delivery: "steer" }`
- **AND** pi flips `isAgentStreaming` to `true` synchronously inside `pi.sendUserMessage` (via agent_start)
- **THEN** the bridge SHALL NOT add to the steer buffer
- **AND** the bridge SHALL NOT emit `queue_update` with a chip
- **AND** the message SHALL be processed by pi as a fresh turn

#### Scenario: Mid-stream steer produces a chip
- **WHEN** `isAgentStreaming === true` at the moment of `send_prompt {delivery:"steer"}`
- **THEN** the bridge SHALL add an entry to the steer buffer
- **AND** the bridge SHALL emit `queue_update` with the new entry

#### Scenario: Slash-route steer fallback buffers when streaming
- **WHEN** a slash-route `sessionPrompt` fallback delivers a steer while `isAgentStreaming === true`
- **THEN** the bridge SHALL add it to the steer buffer and SHALL NOT call `pi.sendUserMessage`

### Requirement: User abort preserves shadow queues and never clears pi's native queues

When the bridge's `abort` extension command is invoked (via a browser `abort { sessionId }` message routed through the server to pi), the bridge SHALL:

1. Latch the abort (`abortLatch.request(sessionId)`) BEFORE invoking `cachedCtx.abort()`, so a long provider backoff that outlives the 2 s persistent-abort scheduler still stops pi when it wakes to retry.
2. Invoke `cachedCtx.abort()`.
3. Call `retryTracker.noteAbort(sessionId)` (clears the in-flight attempt counter). The bridge SHALL NOT call `usageLimitOrderer.noteRetryEnd(sessionId)`; the orderer's `pending` flag MUST survive user-initiated abort so that pi's eventual terminal `agent_end` can still surface the real provider `errorMessage` via the orderer's `maybeSynthesize` path.

The bridge SHALL NOT reset the steer buffer or `bridgeFollowUp` on abort, and SHALL NOT emit a `queue_update` from the abort path. Held steers stay held (an aborted turn never hands steers to pi, see "Bridge hands held steers to pi at turn_end before pi drains") and follow the settle rule.

Because both buffers survive abort, their retained bytes also survive. The aggregate byte ceilings are unaffected: the accounted totals are derived from the live entries at each check.

The wrapper-abort SHALL run exactly ONCE on the initial `abort` command. Subsequent persistent-abort scheduler ticks (see `provider-retry-state` "Bridge persistent-abort scheduler closes retry race") SHALL invoke `cachedCtx.abort()` directly (raw), NOT the wrapper.

#### Scenario: Abort does not clear the follow-up buffer
- **WHEN** `bridgeFollowUp` holds two entries, one carrying images
- **AND** the bridge's `abort` extension command is invoked
- **THEN** the bridge SHALL invoke `cachedCtx.abort()`
- **AND** `bridgeFollowUp` SHALL still hold both entries with their images
- **AND** the bridge SHALL NOT emit `queue_update` from the abort path

#### Scenario: Abort does not clear held steers
- **WHEN** the steer buffer holds one held entry
- **AND** the bridge's `abort` extension command is invoked
- **THEN** the steer buffer SHALL still hold that entry

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

### Requirement: Bridge follow-up drain loop runs on agent_settled with pop-before-send invariant

The bridge SHALL schedule `drainFollowupQueue()` via `setTimeout(_, 0)` from its `agent_settled` handler, and SHALL NOT schedule it from `agent_end`. pi emits `agent_settled` once per run, after any auto-retry attempts and queued-message continuations, and only after it has cleared its active-run state. The `setTimeout` lets the send observe a settled, idle session instead of being deferred by pi into its settle-emission queue.

The drain function SHALL enforce the following invariants in order:

1. **Re-entrancy lock**: a boolean `isDraining` SHALL prevent overlapping drain frames. Set true after gates pass; cleared in `finally`. Re-entrant calls early-return.
2. **Empty-buffer gate**: if the steer buffer and `bridgeFollowUp` are both empty, drain bails immediately.
3. **TUI-coexistence gate**: if `ctx.hasPendingMessages()` returns true, drain bails.
4. **Single idle check**: if `ctx.isIdle()` returns false (a run has already started, e.g. a TUI prompt or another extension's settle action), drain SHALL return without popping and without re-scheduling itself. The next `agent_settled` drains.
5. **Pop FIRST**: the drain SHALL take the oldest held steer when the steer buffer is non-empty, else `bridgeFollowUp.shift()`, BEFORE any pi call. A drained steer that carries a `promptId` SHALL be acknowledged with `prompt_received { fresh: false, promptId }`.
6. **Emit BEFORE send**: `emitQueueUpdate()` SHALL fire reflecting the popped state BEFORE calling pi.
7. **Fresh-turn send, NO deliverAs**: the drain SHALL call `pi.sendUserMessage(content)` with NO options, where `content` is the entry's text alone when it carries no images, or a content array `[{type:"text"}, {type:"image"}...]` when it does.
8. **Catch + drop on pi error**: any synchronous exception from `pi.sendUserMessage` SHALL be caught, logged as `console.warn` containing "drainFollowupQueue" and "entry lost", and the entry SHALL NOT be re-pushed. pi's extension `sendUserMessage` is fire-and-forget: an asynchronous rejection (e.g. compaction started) goes to pi's extension error channel, not to this catch, so it is not logged here.

The drain SHALL handle at most one entry per `agent_settled`, held steers before follow-ups; multiple queued entries drain across successive runs in FIFO order within each buffer. Draining an entry SHALL release its accounted bytes. A system follow-up (`enqueueSystemFollowup`) SHALL keep scheduling the same drain via `setTimeout(_, 0)`: shipped at once when idle, otherwise by the next `agent_settled`.

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

#### Scenario: Held steer drains before follow-ups
- **WHEN** the steer buffer holds `"s"` and `bridgeFollowUp` holds `"f"`
- **AND** pi emits `agent_settled` with the session idle and no pending messages
- **THEN** the drain SHALL send `"s"` with no `deliverAs` and keep `"f"`

#### Scenario: Held steer alone is not blocked by the empty-buffer gate
- **WHEN** the steer buffer holds `"s"` and `bridgeFollowUp` is empty
- **AND** pi emits `agent_settled` with the session idle and no pending messages
- **THEN** the drain SHALL send `"s"`

## ADDED Requirements

### Requirement: Bridge maintains steer and follow-up buffers

The bridge SHALL keep two per-session in-memory buffers: held dashboard steers `{ id, text, images?, promptId? }` and `bridgeFollowUp` `{ text, images? }` (unchanged). A steer leaves its buffer only when handed to pi, cancelled, or shipped by the settle drain; `message_start` never changes it. Both feed one `queue_update` of views without image bytes. Session change (new / fork / resume) resets both and emits `queue_update` once.

#### Scenario: Bridge records a steer mid-stream
- **WHEN** the agent is streaming
- **AND** the bridge receives a steer `"focus on X"`
- **THEN** the steer buffer SHALL hold one entry with text `"focus on X"`
- **AND** the bridge SHALL emit `queue_update`

#### Scenario: message_start never touches held steers
- **WHEN** the steer buffer holds `"hello"`
- **AND** pi emits user `message_start` with content `"hello"` (for example a TUI-typed message)
- **THEN** the steer buffer SHALL still hold `"hello"`

#### Scenario: Follow-up matcher is a no-op for buffered entries
- **WHEN** `bridgeFollowUp` is `[{ text: "queued by dashboard" }]` (buffered, not yet drained)
- **AND** the drain loop pops that entry and sends it via `pi.sendUserMessage` with no `deliverAs`
- **AND** pi emits user `message_start` with content `"queued by dashboard"`
- **THEN** the follow-up matcher SHALL find no entry and SHALL NOT emit `queue_update`

#### Scenario: Session-change resets both structures
- **WHEN** the bridge handles `session_start` with `reason ∈ {"new", "fork", "resume"}`
- **AND** either buffer is non-empty
- **THEN** the bridge SHALL empty both buffers
- **AND** the bridge SHALL emit `queue_update { steering: [], followUp: [] }` once

#### Scenario: Session-change releases buffered image bytes
- **WHEN** either buffer holds an entry carrying images
- **AND** the bridge handles `session_start` with `reason: "resume"`
- **THEN** both buffers SHALL become empty
- **AND** each buffer's accounted byte total SHALL return to zero

### Requirement: Steer ids are unique across bridge lifetimes

Each held steer SHALL get an `id` that is never reused within a session, including across bridge restarts (for example an instance nonce plus a sequence number), so a cancel sent before a restart can never match a new entry.

#### Scenario: Id from before a reload never matches
- **WHEN** the browser holds steer id `X` from a bridge instance that has since reloaded
- **AND** the new bridge instance holds a new steer
- **THEN** the new steer's id SHALL differ from `X`

### Requirement: Bridge re-announces its queues on register

On every register or re-register with the server, the bridge SHALL emit `queue_update` with its current buffers, including when both are empty, so no stale steer bubble survives a bridge restart.

#### Scenario: Reload clears stale bubbles
- **WHEN** the server cached `pendingQueues.steering` with one entry
- **AND** the bridge reloads with empty buffers and re-registers
- **THEN** the bridge SHALL emit `queue_update { steering: [], followUp: [] }`

### Requirement: Streaming steers are buffered in the bridge

When the agent is streaming and the bridge receives a non-command `send_prompt` with `delivery: "steer"`, it SHALL validate its images as follow-ups do, push `{ id, text, images?, promptId? }` into the steer buffer, and emit `queue_update`. It SHALL NOT call `pi.sendUserMessage` at send time. Follow-up routing is unchanged. Idle sends of either delivery go straight to pi and bypass both buffers.

#### Scenario: Steer send during streaming buffers in bridge
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "focus on auth", delivery: "steer", images: [img] }`
- **THEN** the bridge SHALL push `{ id, text: "focus on auth", images: [img] }` to the steer buffer
- **AND** the bridge SHALL emit `queue_update` whose `steering` holds `{ id, text: "focus on auth", imageCount: 1 }`
- **AND** the bridge SHALL NOT call `pi.sendUserMessage` for this message

#### Scenario: Follow-up send while streaming still buffers as before
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "second", delivery: "followUp" }`
- **THEN** the bridge SHALL push `{ text: "second" }` to `bridgeFollowUp`
- **AND** the steer buffer SHALL stay unchanged

#### Scenario: Idle steer bypasses the steer buffer
- **WHEN** the agent is idle
- **AND** the bridge receives `send_prompt { text: "hi", delivery: "steer" }`
- **THEN** the bridge SHALL call `pi.sendUserMessage("hi", { deliverAs: "steer" })`
- **AND** the steer buffer SHALL stay unchanged

#### Scenario: Invalid image dropped and reported at admission
- **WHEN** a streaming steer carries one valid and one oversized image
- **THEN** the steer buffer entry SHALL carry only the valid image
- **AND** the bridge SHALL send command feedback for `send_prompt` naming the dropped image

### Requirement: A steer's promptId is acknowledged when it reaches pi

The `prompt_received` ack sent when a streaming steer is buffered SHALL carry `fresh: false` and no `promptId`. When the bridge later hands that steer to pi (at `turn_end` or by the settle drain), it SHALL emit `prompt_received { fresh: false, promptId }` with the entry's `promptId`, if it had one.

#### Scenario: promptId follows the hand-off
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "x", delivery: "steer", promptId: "p1" }`
- **THEN** the bridge SHALL emit `prompt_received { fresh: false }` without `promptId`
- **AND** when it hands `"x"` to pi it SHALL emit `prompt_received { fresh: false, promptId: "p1" }`

#### Scenario: Cancelled steer never acks its promptId
- **WHEN** a held steer with `promptId: "p1"` is cancelled
- **THEN** the bridge SHALL NOT emit `prompt_received` carrying `promptId: "p1"`

### Requirement: Bridge hands held steers to pi at turn_end before pi drains

In its `turn_end` handler, which pi awaits before draining its steer queue, the bridge SHALL hand off held steers only when the event's `outcome` is `"completed"`: `"one-at-a-time"` (pi's default `steeringMode`) takes the oldest entry, `"all"` takes every entry. It SHALL remove the taken entries from the buffer and emit `queue_update` in one synchronous step, then call `pi.sendUserMessage(content, { deliverAs: "steer" })` for each, oldest first, yielding one macrotask after each send.

#### Scenario: One-at-a-time hands off the head only
- **WHEN** `steeringMode` is `"one-at-a-time"` and the steer buffer holds `"a"`, `"b"`
- **AND** pi fires `turn_end` with `outcome: "completed"`
- **THEN** the bridge SHALL remove `"a"` and send it with `deliverAs: "steer"`
- **AND** `"b"` SHALL stay held

#### Scenario: All mode hands off every entry in order
- **WHEN** `steeringMode` is `"all"` and the steer buffer holds `"a"`, `"b"`
- **AND** pi fires `turn_end` with `outcome: "completed"`
- **THEN** the bridge SHALL remove both in one step, then send `"a"` before `"b"`

#### Scenario: Aborted or errored turn hands nothing off
- **WHEN** the steer buffer holds `"a"`
- **AND** pi fires `turn_end` with `outcome: "aborted"` or `"error"`
- **THEN** `"a"` SHALL stay held
- **AND** the bridge SHALL NOT call `pi.sendUserMessage`

#### Scenario: Handed-off steer is delivered in the same boundary
- **WHEN** the bridge hands `"a"` to pi during a completed `turn_end`
- **THEN** pi SHALL deliver `"a"` as a user message before its next LLM call

#### Scenario: Images ride the hand-off
- **WHEN** a held entry carries two images
- **AND** the bridge hands it off
- **THEN** the content passed to `pi.sendUserMessage` SHALL hold the text and both images

#### Scenario: Cancel during a hand-off cannot reach a taken entry
- **WHEN** `"all"` mode takes entries `1` and `2` and a `remove_steering_entry { id: "2" }` is handled during the yield after sending `1`
- **THEN** the remove SHALL be refused as already sent
- **AND** `2` SHALL be sent

### Requirement: Held steers are cancellable until hand-off

The bridge SHALL handle `remove_steering_entry { sessionId, id }` by removing the held entry with that `id`, and `clear_steering_entries { sessionId }` by removing every held entry; each SHALL emit `queue_update`. A remove whose `id` is not held SHALL change nothing and SHALL send command feedback that the steer was already sent or cancelled. No path SHALL call a pi method.

#### Scenario: Cancel one held steer
- **WHEN** the steer buffer holds entries `1` and `2`
- **AND** the bridge receives `remove_steering_entry { id: "2" }`
- **THEN** the buffer SHALL hold entry `1` only
- **AND** the bridge SHALL emit `queue_update`

#### Scenario: Late cancel after hand-off is refused
- **WHEN** entry `1` was handed to pi at `turn_end`
- **AND** the bridge receives `remove_steering_entry { id: "1" }`
- **THEN** both buffers SHALL be unchanged
- **AND** the bridge SHALL send command feedback for `remove_steering_entry` saying the steer was already sent or cancelled

#### Scenario: Clear all empties the steer buffer
- **WHEN** the steer buffer holds `1`, `2`, `3`
- **AND** the bridge receives `clear_steering_entries`
- **THEN** the steer buffer SHALL be empty
- **AND** `bridgeFollowUp` SHALL be unchanged

#### Scenario: Server relays steer mutations
- **WHEN** a browser sends `remove_steering_entry { sessionId: "S", id: "2" }`
- **THEN** the server SHALL forward it unchanged to the bridge of session `S`

### Requirement: Held steers drain as fresh prompts when the run settles

On `agent_settled`, if held steers remain (sent after the last completed `turn_end`, no handler ran, or the run aborted or failed), the settle drain SHALL ship the oldest one as a fresh prompt with its images, ahead of any follow-up, one entry per settle, under the follow-up drain's lock and idle/pending gates.

#### Scenario: Steer sent after the last turn_end drains first
- **WHEN** the steer buffer holds `"a"` and `bridgeFollowUp` holds `"b"`
- **AND** pi emits `agent_settled` and the session is idle with no pending messages
- **THEN** the bridge SHALL send `"a"` as a fresh prompt and remove it from the steer buffer
- **AND** `"b"` SHALL stay in `bridgeFollowUp` for a later settle

#### Scenario: Held steer after abort drains at settle
- **WHEN** the steer buffer holds `"a"`
- **AND** the user aborts the run and pi emits `agent_settled` with `aborted: true`
- **THEN** the drain SHALL treat `"a"` exactly as it treats a follow-up after an abort

### Requirement: Steer buffer enforces the follow-up bounds

The steer buffer SHALL apply the same entry cap and aggregate byte ceiling as the follow-up buffer, independently. A steer that would exceed either bound SHALL be refused whole, never stripped of images, and the refusal SHALL be reported as command feedback for `send_prompt`.

#### Scenario: Oversized steer refused whole
- **WHEN** a streaming steer's images would push the steer buffer past its byte ceiling
- **THEN** the bridge SHALL NOT add the entry
- **AND** the bridge SHALL send command feedback for `send_prompt` naming the limit

### Requirement: Pending steer bubbles offer cancel, clear-all and an image marker

Each `pendingQueues.steering[]` entry SHALL render as a user-style bubble at the bottom of `ChatView`, keyed by `id`, with a `STEERING` header and spinner. Each bubble SHALL show the follow-up ✕ remove control in its body row; `imageCount > 0` SHALL show the follow-up image badge. From two entries, the follow-up lane's `Clear all` SHALL render below the stack. No confirmation.

#### Scenario: Pending steer appears at the bottom of chat
- **WHEN** `pendingQueues.steering` is `[{ id: "1", text: "focus on X", imageCount: 0 }]`
- **AND** the message list ends with an assistant message
- **THEN** `ChatView` SHALL render "focus on X" as a bubble after the assistant message with a `STEERING` header and spinner
- **AND** the bubble SHALL render a `pending-steer-cancel-1` control

#### Scenario: Image count badge on a steer with images
- **WHEN** a steering entry has `imageCount: 2`
- **THEN** its bubble SHALL render `pending-steer-attachments` showing `2`

#### Scenario: Clear all from two entries
- **WHEN** `pendingQueues.steering` holds two entries
- **THEN** `pending-steer-clear-all` SHALL render below the stack
- **AND** with one entry it SHALL NOT render

#### Scenario: Cancel sends a remove by id
- **WHEN** the user clicks `pending-steer-cancel-1`
- **THEN** the client SHALL send `remove_steering_entry { sessionId, id: "1" }`
- **AND** no confirmation dialog SHALL open

#### Scenario: Steer chip disappears when the buffer clears
- **WHEN** `pendingQueues.steering` transitions from one entry to `[]`
- **THEN** the inline bubble SHALL disappear

### Requirement: Client tolerates legacy string steering entries

For one release the client SHALL accept `pendingQueues.steering` elements that are plain strings, rendering each as a `STEERING` bubble with `imageCount: 0` and no cancel control (no `id` to target).

#### Scenario: Legacy string entry renders without cancel
- **WHEN** `pendingQueues.steering` is `["focus on X"]`
- **THEN** `ChatView` SHALL render a `STEERING` bubble for "focus on X"
- **AND** the bubble SHALL NOT render a cancel control

## REMOVED Requirements

### Requirement: Steer queue is permanently pi-owned + display-only — no bridge-owned-steer
**Reason**: Its premises do not hold. A steer can wait minutes behind a long tool or subagent call, and pi awaits extension `turn_end` handlers before draining its steer queue, so a bridge-held steer has one race-free hand-off point.
**Migration**: Dashboard steers sent while streaming live in the bridge steer buffer until handed to pi at a completed `turn_end` (see "Bridge hands held steers to pi at turn_end before pi drains"); cancel via `remove_steering_entry` / `clear_steering_entries`. TUI-typed steers remain pi-owned.

### Requirement: Typed-during-streaming prompts are forwarded to pi's native queues
**Reason**: Streaming steers no longer go to pi's native queue at send time; they are held in the bridge and handed to pi at `turn_end`.
**Migration**: See "Streaming steers are buffered in the bridge" and "Bridge hands held steers to pi at turn_end before pi drains". Follow-up and idle routing are unchanged; the no-`pi.clear*Queue` rule stays in "Pi ExtensionAPI does not expose queue-mutation methods".

### Requirement: Pending steer entries render inline in chat as user-style bubbles
**Reason**: Steer bubbles now carry cancel, clear-all and an image marker, and the stale-client `clear_steering_queue` scenario no longer applies.
**Migration**: See "Pending steer bubbles offer cancel, clear-all and an image marker". The legacy `clear_steering_queue` message stays deleted (dropped by the router).

### Requirement: Bridge maintains shadow steering and follow-up queues
**Reason**: The steer side is no longer a shadow of pi's queue; held steers are bridge-owned until handed to pi, and pi-delivered steers are not tracked.
**Migration**: See "Bridge maintains steer and follow-up buffers". Follow-up buffer behaviour is unchanged.
