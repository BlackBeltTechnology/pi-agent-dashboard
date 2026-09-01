## MODIFIED Requirements

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

### Requirement: Follow-up send appends to the queue (v2 replace of v1 send-while-occupied semantics)

When the user presses Alt+Enter (or equivalent send-with-followup gesture), the client SHALL dispatch `send_prompt { delivery: "followUp", text, images? }`. The bridge SHALL append the new entry to `bridgeFollowUp[]` (never replace existing entries), carrying any `images` from the `send_prompt` message onto the entry. The client SHALL update `currentIndex` to point at the newly-appended entry ONLY once the append is observed in `pendingQueues.followUp` (a refused send appends nothing, so there is no entry at the new index).

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

### Requirement: User abort preserves shadow queues and never clears pi's native queues

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: rewriteFollowupQueue requires active streaming

**Reason**: The `rewriteFollowupQueue` helper this requirement governs no longer exists — it was deleted because the clear-then-replay strategy was broken by construction: `pi.clearFollowUpQueue` is not on the ExtensionAPI, so the "clear" step was a silent no-op and the replay appended ghost entries to pi's real queue (`bridge.ts:541-544`). The requirement's scenarios mandate `pi.clearFollowUpQueue()` and `pi.sendUserMessage(_, { deliverAs: "followUp" })` for `edit_followup_entry`, `promote_followup_entry`, and `remove_followup_entry` — the exact calls that "Per-entry follow-up mutation mutates ONLY the bridge buffer" forbids for those same handlers. Retiring it removes a direct self-contradiction in the merged capability.

**Migration**: Mutation-handler behaviour is specified solely by "Per-entry follow-up mutation mutates ONLY the bridge buffer": handlers mutate the bridge-owned buffer and call no pi method. The idle-session hazard this requirement guarded against cannot arise, because no mutation handler calls `pi.sendUserMessage` at all. Out-of-range and byte-ceiling refusals are reported via `command_feedback` as specified there.

### Requirement: Follow-up queue surface is display-only with cycling navigation

**Reason**: Contradicted by the shipped UI and by the mutation capability this change modifies. The requirement states that `queue-followup-promote`, `queue-followup-remove`, `queue-followup-edit`, and `queue-followup-editor` SHALL NEVER be in the DOM, but `QueuePanel` renders all four, and "Per-entry follow-up mutation mutates ONLY the bridge buffer" specifies the bridge handlers those controls drive. A capability cannot both forbid the controls and specify their behaviour.

**Migration**: Cycling navigation (`queue-followup-prev`, `queue-followup-next`, `queue-followup-position`) and the single-visible-entry model are retained by "Follow-up display chip caps rendered height and scrolls on overflow" and "Queue render cap keeps the LATEST entries visible". Mutation controls are governed by "Per-entry follow-up mutation mutates ONLY the bridge buffer". Attachment display on the chip is governed by "Queued follow-up chip indicates attached images".

### Requirement: Image attachments are not displayed on chips in v1

**Reason**: Superseded on two independent grounds. (1) Its central promise — that the bridge holds the original `images` array on the queued entry — was false: `rework-mid-turn-prompt-queue` replaced the image-carrying buffer with `string[]`, so images were dropped at buffer time and never reached the model. This change restores image carriage and adds the attachment indicator the requirement forbade. (2) Its scenario describes an optimistic card rendering with image thumbnails for a mid-turn send, which contradicts `optimistic-prompt` — that capability requires `pendingPrompt` to be set ONLY for idle sends and states the optimistic card can never co-exist with a mid-turn queue chip. The requirement also refers to `PendingPrompt`, a type this spec removed.

**Migration**: Image carriage through the buffer is now specified by "Bridge maintains shadow steering and follow-up queues" (entry shape) and the drain requirement's "Drain preserves image attachments" scenario, which is re-homed there. Chip display of attachments is now specified by "Queued follow-up chip indicates attached images". Optimistic-card behaviour for mid-turn sends is governed solely by `optimistic-prompt` (mid-turn sends set no `pendingPrompt`), with no counter-statement in this capability.
