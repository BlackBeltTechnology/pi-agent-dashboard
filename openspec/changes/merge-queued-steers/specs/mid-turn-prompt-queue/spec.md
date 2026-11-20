## ADDED Requirements

### Requirement: Held steers can be merged into one steer

The bridge SHALL handle `merge_steering_entries { sessionId }`, when two or more steers are held, by replacing every held steer with ONE held steer that keeps the originals in order. It keeps the first entry's id when that entry is already merged, otherwise it gets a new id. A merged steer's text SHALL be its originals' texts joined by a blank line (`"\n\n"`), its images SHALL be the originals' images in order, and its view SHALL carry `mergedCount` (number of originals). Merging a held merged steer contributes its originals, never a nested merge. The bridge SHALL always emit `queue_update`, even when there was nothing to join. No path SHALL call a pi method.

#### Scenario: Merge joins held steers in order
- **WHEN** the steer buffer holds `"a"` (id `1`) and `"b"` (id `2`, 1 image)
- **AND** the bridge receives `merge_steering_entries`
- **THEN** the steer buffer SHALL hold exactly one entry with a new id
- **AND** `queue_update.steering` SHALL be `[{ id: <new>, text: "a\n\nb", imageCount: 1, mergedCount: 2 }]`

#### Scenario: Merge flattens an existing merged steer
- **WHEN** the steer buffer holds a merged steer of `"a"`, `"b"` followed by plain `"c"`
- **AND** the bridge receives `merge_steering_entries`
- **THEN** the buffer SHALL hold one merged steer whose text is `"a\n\nb\n\nc"` and whose `mergedCount` is `3`

#### Scenario: Merge keeps the id of a leading merged steer
- **WHEN** the steer buffer holds merged steer `M` (`"a"`, `"b"`) followed by plain `"c"`
- **AND** the bridge receives `merge_steering_entries`
- **THEN** the single remaining entry SHALL have id `M` and `mergedCount` `3`

#### Scenario: Merge with one held steer is a re-announce
- **WHEN** the steer buffer holds only `"a"`, or only one merged steer `M`
- **AND** the bridge receives `merge_steering_entries`
- **THEN** the buffer SHALL be unchanged, including the id `M`
- **AND** the bridge SHALL emit `queue_update`

### Requirement: A merged steer can be split back

The bridge SHALL handle `split_steering_entry { sessionId, id }` by replacing the held merged steer `id`, at its position, with its originals, keeping their original ids, texts, images and `promptId`s, and SHALL emit `queue_update`. A split SHALL change nothing and emit `queue_update` when the `id` is not a held merged steer. When the `id` is not held at all, the bridge SHALL also send command feedback for `split_steering_entry` saying the steer was already sent or cancelled. A held plain `id` gets no feedback.

#### Scenario: Split restores the originals with their ids
- **WHEN** steers `1` (`"a"`) and `2` (`"b"`) were merged into `M`
- **AND** the bridge receives `split_steering_entry { id: "M" }`
- **THEN** `queue_update.steering` SHALL hold `{ id: "1", text: "a" }` then `{ id: "2", text: "b" }`, neither with `mergedCount`

#### Scenario: Split after hand-off is refused
- **WHEN** merged steer `M` was handed to pi
- **AND** the bridge receives `split_steering_entry { id: "M" }`
- **THEN** the bridge SHALL send command feedback for `split_steering_entry` saying the steer was already sent or cancelled

#### Scenario: Double split is a silent re-announce
- **WHEN** merged steer `M` (originals `1`, `2`) was split, so `1` and `2` are held
- **AND** the bridge receives `split_steering_entry { id: "1" }`
- **THEN** the buffer SHALL be unchanged
- **AND** the bridge SHALL emit `queue_update` and SHALL NOT send command feedback

#### Scenario: Merge and split frames for another session are dropped
- **WHEN** the bridge's current session is `T`
- **AND** it receives `split_steering_entry { sessionId: "S", id: "M" }` or `merge_steering_entries { sessionId: "S" }`
- **THEN** the steer buffer SHALL be unchanged

### Requirement: A merged steer reaches pi as one user message

At hand-off (completed `turn_end`) and in the settle drain, a merged steer SHALL count as ONE entry for the `steeringMode` take and SHALL be delivered with ONE `pi.sendUserMessage` call whose content holds the joined text and every original image.

#### Scenario: One-at-a-time hands off the whole merged steer
- **WHEN** `steeringMode` is `"one-at-a-time"` and the buffer holds one merged steer of `"a"`, `"b"`, `"c"`, `"d"`
- **AND** pi fires `turn_end` with `outcome: "completed"`
- **THEN** the bridge SHALL call `pi.sendUserMessage` exactly once, with text `"a\n\nb\n\nc\n\nd"` and `deliverAs: "steer"`
- **AND** the steer buffer SHALL be empty

#### Scenario: Merged steer keeps its place behind an older plain steer
- **WHEN** `steeringMode` is `"one-at-a-time"` and the buffer holds plain `"x"` followed by a merged steer of `"a"`, `"b"`
- **AND** pi fires `turn_end` with `outcome: "completed"`
- **THEN** only `"x"` SHALL be handed off
- **AND** the merged steer SHALL stay held

### Requirement: Auto-merge setting merges newly queued steers

The bridge SHALL take the global `mergeQueuedSteers` setting (default `false`) from `preferences_update`, applying the field only when it is a boolean. When it is `true`, a streaming steer admitted while at least one steer is already held SHALL be merged with the held steers before the single `queue_update`. A successful split SHALL pause auto-merge. The pause SHALL end when the steer buffer becomes empty for any reason (hand-off, settle drain, cancel, clear, session change) or when the user merges manually. A change to the setting SHALL NOT alter steers already held.

#### Scenario: Steers keep joining one merged steer
- **WHEN** `mergeQueuedSteers` is `true` and the steer buffer is empty
- **AND** streaming steers `"a"`, `"b"`, `"c"` are admitted one after another
- **THEN** after `"a"` the buffer SHALL hold plain `"a"`
- **AND** after `"c"` the buffer SHALL hold one merged steer with text `"a\n\nb\n\nc"` and `mergedCount` `3`
- **AND** each admission SHALL emit exactly one `queue_update`

#### Scenario: Setting off keeps steers separate
- **WHEN** `mergeQueuedSteers` is `false` and the buffer holds `"a"`
- **AND** a streaming steer `"b"` is admitted
- **THEN** the buffer SHALL hold two entries, `"a"` and `"b"`

#### Scenario: Split pauses auto-merge until the queue empties
- **WHEN** `mergeQueuedSteers` is `true` and the user splits merged steer `M` into `"a"`, `"b"`
- **AND** a streaming steer `"c"` is admitted
- **THEN** the buffer SHALL hold three separate entries
- **AND** after the buffer empties, the next two admitted steers SHALL merge

#### Scenario: Manual merge ends the pause
- **WHEN** `mergeQueuedSteers` is `true`, the user split `M` and then merged again
- **AND** a streaming steer `"c"` is admitted
- **THEN** `"c"` SHALL join the merged steer

#### Scenario: Session change ends the pause
- **WHEN** `mergeQueuedSteers` is `true`, auto-merge is paused by a split and `"a"`, `"b"` are held
- **AND** the bridge handles `session_start` with `reason: "new"`
- **THEN** the steer buffer SHALL be empty
- **AND** the next two admitted steers SHALL merge

#### Scenario: Auto-merge keeps the merged steer's id
- **WHEN** `mergeQueuedSteers` is `true` and the buffer holds merged steer `M` (`"a"`, `"b"`)
- **AND** a streaming steer `"c"` is admitted
- **THEN** the buffer SHALL hold one entry with id `M` and `mergedCount` `3`

#### Scenario: Flipping the setting leaves held steers alone
- **WHEN** the buffer holds separate `"a"`, `"b"` and the bridge receives `preferences_update { mergeQueuedSteers: true }`
- **THEN** the buffer SHALL still hold `"a"` and `"b"` separately

#### Scenario: Turning the setting on merges at the next admission
- **WHEN** the buffer holds separate `"a"`, `"b"` and the bridge receives `preferences_update { mergeQueuedSteers: true }`
- **AND** a streaming steer `"c"` is then admitted
- **THEN** the buffer SHALL hold one merged steer with text `"a\n\nb\n\nc"` and `mergedCount` `3`

#### Scenario: Older server never resets the setting
- **WHEN** the bridge holds `mergeQueuedSteers: true`
- **AND** it receives a `preferences_update` without a `mergeQueuedSteers` field
- **THEN** `mergeQueuedSteers` SHALL stay `true`

### Requirement: Server relays the auto-merge setting to bridges

The server SHALL include the `mergeQueuedSteers` config value in every `preferences_update` snapshot it sends (register push, initial-prompt arm, preference broadcasts), and SHALL broadcast a snapshot to every connected bridge when a config write changes the value.

#### Scenario: Config change reaches connected bridges
- **WHEN** `mergeQueuedSteers` is saved as `true` through the config write endpoint
- **THEN** the server SHALL send `preferences_update` with `mergeQueuedSteers: true` to every connected bridge

#### Scenario: Setting survives a server restart
- **WHEN** `mergeQueuedSteers: true` is saved and the server restarts
- **AND** a bridge registers with the restarted server
- **THEN** its register-time `preferences_update` SHALL carry `mergeQueuedSteers: true`

#### Scenario: Registering bridge receives the setting
- **WHEN** `mergeQueuedSteers` is `true` and a bridge registers
- **THEN** its register-time `preferences_update` SHALL carry `mergeQueuedSteers: true`

### Requirement: Server relays steer merge and split

The server SHALL forward `merge_steering_entries { sessionId }` and `split_steering_entry { sessionId, id }` unchanged to the bridge of session `sessionId`, with the same tier, session-scope and existence checks as `remove_steering_entry`. ACP sessions SHALL ignore both. Neither SHALL be advertised as an MCP tool.

#### Scenario: Server relays merge
- **WHEN** a browser sends `merge_steering_entries { sessionId: "S" }`
- **THEN** the server SHALL forward it unchanged to the bridge of session `S`

#### Scenario: Server relays split
- **WHEN** a browser sends `split_steering_entry { sessionId: "S", id: "M" }`
- **THEN** the server SHALL forward it unchanged to the bridge of session `S`

## MODIFIED Requirements

### Requirement: Server caches per-session queue state from `queue_update` events

The server SHALL maintain a per-session `pendingQueues: { steering: SteerEntryView[]; followUp: FollowUpEntryView[] }` field inside `SessionUiState`, where `FollowUpEntryView = { text: string; imageCount: number }` and `SteerEntryView = { id: string; text: string; imageCount: number; mergedCount?: number }` (`mergedCount` present only on a merged steer). The field SHALL be updated whenever a `queue_update` ExtensionToServerMessage arrives from a bridge for that session. The server SHALL include `pendingQueues` in every `session_updated` broadcast and in the initial-state replay sent on browser subscribe.

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

#### Scenario: Merged steer round-trips its mergedCount
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [{ id: "M", text: "a\n\nb", imageCount: 0, mergedCount: 2 }], followUp: [] }`
- **THEN** the broadcast SHALL carry `mergedCount: 2` on that entry unmodified

#### Scenario: Empty arrays clear the cache slot
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [], followUp: [] }`
- **THEN** the server SHALL set `SessionUiState[S].pendingQueues = { steering: [], followUp: [] }`
- **AND** the server SHALL broadcast `session_updated`

#### Scenario: Reconnect replays the cached state
- **WHEN** a browser subscribes to session "S" whose `pendingQueues` is non-empty
- **THEN** the initial-state snapshot SHALL include the current `pendingQueues` value
- **AND** the client SHALL render chips for both arrays without waiting for a fresh `queue_update`

### Requirement: Bridge maintains steer and follow-up buffers

The bridge SHALL keep two per-session in-memory buffers: held dashboard steers and `bridgeFollowUp` `{ text, images? }` (unchanged). A held steer is either plain `{ id, text, images?, promptId? }` or merged `{ id, parts }`, where `parts` are two or more plain originals. A steer leaves its buffer only when handed to pi, cancelled, or shipped by the settle drain, or when a merge or split replaces it in the buffer. `message_start` never changes it. Both feed one `queue_update` of views without image bytes. Session change (new / fork / resume) resets both, including the auto-merge split pause, and emits `queue_update` once.

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

### Requirement: Streaming steers are buffered in the bridge

When the agent is streaming and the bridge receives a non-command `send_prompt` with `delivery: "steer"`, it SHALL validate its images as follow-ups do, push `{ id, text, images?, promptId? }` into the steer buffer, apply auto-merge when it is on (see "Auto-merge setting merges newly queued steers"), and emit `queue_update` once. It SHALL NOT call `pi.sendUserMessage` at send time. Follow-up routing is unchanged. Idle sends of either delivery go straight to pi and bypass both buffers.

#### Scenario: Steer send during streaming buffers in bridge
- **WHEN** the agent is streaming and auto-merge is off
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

The `prompt_received` ack sent when a streaming steer is buffered SHALL carry `fresh: false` and no `promptId`. When the bridge later hands that steer to pi (at `turn_end` or by the settle drain), it SHALL emit `prompt_received { fresh: false, promptId }` with the entry's `promptId`, if it had one. For a merged steer, it SHALL emit one such ack for each original that had a `promptId`, after the single send.

#### Scenario: promptId follows the hand-off
- **WHEN** the agent is streaming
- **AND** the bridge receives `send_prompt { text: "x", delivery: "steer", promptId: "p1" }`
- **THEN** the bridge SHALL emit `prompt_received { fresh: false }` without `promptId`
- **AND** when it hands `"x"` to pi it SHALL emit `prompt_received { fresh: false, promptId: "p1" }`

#### Scenario: Every original promptId of a merged steer is acked
- **WHEN** originals with `promptId` `p1` and `p2` were merged
- **AND** the merged steer is handed to pi
- **THEN** the bridge SHALL emit `prompt_received { fresh: false, promptId: "p1" }` and `prompt_received { fresh: false, promptId: "p2" }`

#### Scenario: Cancelled steer never acks its promptId
- **WHEN** a held steer with `promptId: "p1"`, or a merged steer containing it, is cancelled
- **THEN** the bridge SHALL NOT emit `prompt_received` carrying `promptId: "p1"`

### Requirement: Steer ids are unique across bridge lifetimes

Each held steer SHALL get an `id` that is never reused within a session, including across bridge restarts (for example an instance nonce plus a sequence number), so a cancel sent before a restart can never match a new entry. A merge either keeps the id of a leading merged steer or mints a new id. A split restores its originals' own ids. Neither ever assigns an id to a different steer.

#### Scenario: Id from before a reload never matches
- **WHEN** the browser holds steer id `X` from a bridge instance that has since reloaded
- **AND** the new bridge instance holds a new steer
- **THEN** the new steer's id SHALL differ from `X`

#### Scenario: Split restores, never reuses for another steer
- **WHEN** steers `1` and `2` are merged into `M`, then split
- **THEN** the held ids SHALL be `1` and `2` with their own texts
- **AND** a later merge of plain steers SHALL get an id that differs from `M`, `1` and `2`

### Requirement: Bridge follow-up drain loop runs on agent_settled with pop-before-send invariant

The bridge SHALL schedule `drainFollowupQueue()` via `setTimeout(_, 0)` from its `agent_settled` handler, and SHALL NOT schedule it from `agent_end`. pi emits `agent_settled` once per run, after any auto-retry attempts and queued-message continuations, and only after it has cleared its active-run state. The `setTimeout` lets the send observe a settled, idle session instead of being deferred by pi into its settle-emission queue.

The drain function SHALL enforce the following invariants in order:

1. **Re-entrancy lock**: a boolean `isDraining` SHALL prevent overlapping drain frames. Set true after gates pass; cleared in `finally`. Re-entrant calls early-return.
2. **Empty-buffer gate**: if the steer buffer and `bridgeFollowUp` are both empty, drain bails immediately.
3. **TUI-coexistence gate**: if `ctx.hasPendingMessages()` returns true, drain bails.
4. **Single idle check**: if `ctx.isIdle()` returns false (a run has already started, e.g. a TUI prompt or another extension's settle action), drain SHALL return without popping and without re-scheduling itself. The next `agent_settled` drains.
5. **Pop FIRST**: the drain SHALL take the oldest held steer when the steer buffer is non-empty, else `bridgeFollowUp.shift()`, BEFORE any pi call. A drained steer SHALL be acknowledged with `prompt_received { fresh: false, promptId }` once for each `promptId` it carries: its own for a plain steer, each original's for a merged steer.
6. **Emit BEFORE send**: `emitQueueUpdate()` SHALL fire reflecting the popped state BEFORE calling pi.
7. **Fresh-turn send, NO deliverAs**: the drain SHALL call `pi.sendUserMessage(content)` with NO options, where `content` is the entry's text alone when it carries no images, or a content array `[{type:"text"}, {type:"image"}...]` when it does. For a merged steer, the text is its originals' texts joined by `"\n\n"` and the images are all its originals' images in order.
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

#### Scenario: Merged steer drains as one prompt with every ack
- **WHEN** the steer buffer holds one merged steer of `"a"` (`promptId: "p1"`) and `"b"` (`promptId: "p2"`)
- **AND** pi emits `agent_settled` with the session idle and no pending messages
- **THEN** the drain SHALL call `pi.sendUserMessage("a\n\nb")` once with NO send options
- **AND** emit `prompt_received { fresh: false, promptId: "p1" }` and `prompt_received { fresh: false, promptId: "p2" }`

### Requirement: Held steers are cancellable until hand-off

The bridge SHALL handle `remove_steering_entry { sessionId, id }` by removing the held entry with that `id`, and `clear_steering_entries { sessionId }` by removing every held entry; each SHALL emit `queue_update`. Removing a merged steer removes all of its originals. Originals inside a merged steer are not held entries: a remove addressed to an original's id is refused like any id that is not held. A remove whose `id` is not held SHALL change nothing and SHALL send command feedback that the steer was already sent or cancelled. No path SHALL call a pi method.

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

#### Scenario: Cancelling the merged steer removes all of it
- **WHEN** the buffer holds one merged steer with id `M` built from three originals
- **AND** the bridge receives `remove_steering_entry { id: "M" }`
- **THEN** the steer buffer SHALL be empty

#### Scenario: Cancel of an absorbed original is refused
- **WHEN** steers `1` and `2` were merged into `M`
- **AND** the bridge receives `remove_steering_entry { id: "1" }`
- **THEN** the buffer SHALL still hold `M` unchanged
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

On `agent_settled`, if held steers remain (sent after the last completed `turn_end`, no handler ran, or the run aborted or failed), the settle drain SHALL ship the oldest held entry as a fresh prompt with its images, ahead of any follow-up, one entry per settle, under the follow-up drain's lock and idle/pending gates. A merged entry ships as ONE prompt carrying its joined text and every original image.

#### Scenario: Steer sent after the last turn_end drains first
- **WHEN** the steer buffer holds `"a"` and `bridgeFollowUp` holds `"b"`
- **AND** pi emits `agent_settled` and the session is idle with no pending messages
- **THEN** the bridge SHALL send `"a"` as a fresh prompt and remove it from the steer buffer
- **AND** `"b"` SHALL stay in `bridgeFollowUp` for a later settle

#### Scenario: Held steer after abort drains at settle
- **WHEN** the steer buffer holds `"a"`
- **AND** the user aborts the run and pi emits `agent_settled` with `aborted: true`
- **THEN** the drain SHALL treat `"a"` exactly as it treats a follow-up after an abort

#### Scenario: Settle drain ships a merged steer as one prompt
- **WHEN** a merged steer of `"a"`, `"b"` is still held when pi emits `agent_settled` and the session is idle
- **THEN** the drain SHALL send ONE fresh prompt with text `"a\n\nb"` and every original image

### Requirement: Steer buffer enforces the follow-up bounds

The steer buffer SHALL apply the same entry cap and aggregate byte ceiling as the follow-up buffer, independently, counting each original inside a merged steer as one entry with its full bytes; the blank-line separators of a merged steer are not counted. Merging or splitting SHALL never change the counted totals. A steer that would exceed either bound SHALL be refused whole, never stripped of images, and the refusal SHALL be reported as command feedback for `send_prompt`.

#### Scenario: Oversized steer refused whole
- **WHEN** a streaming steer's images would push the steer buffer past its byte ceiling
- **THEN** the bridge SHALL NOT add the entry
- **AND** the bridge SHALL send command feedback for `send_prompt` naming the limit

#### Scenario: Merging frees no entry capacity
- **WHEN** the steer buffer holds 20 originals, merged into one steer
- **AND** a 21st streaming steer arrives
- **THEN** the bridge SHALL refuse it whole with command feedback for `send_prompt`

#### Scenario: Merging frees no byte capacity
- **WHEN** the held originals total just under the byte ceiling and are merged into one steer
- **AND** a streaming steer arrives whose bytes would cross the ceiling
- **THEN** the bridge SHALL refuse it whole with command feedback for `send_prompt`

### Requirement: Pending steer bubbles offer cancel, clear-all and an image marker

Each `pendingQueues.steering[]` entry SHALL render as a user-style bubble at the bottom of `ChatView`, keyed by `id`, with no per-bubble header. One group label with a spinner SHALL render above the bubbles: `Steering` for one plain entry, `Steering · N` for N ≥ 2 entries, `Steering · merged` for exactly one entry with `mergedCount ≥ 2`, each followed by `· sends after this turn`. The bubbles SHALL stack with a tight gap. Each bubble SHALL show the follow-up ✕ remove control in its body row; `imageCount > 0` SHALL show the follow-up image badge. A control row below the stack SHALL show at most one of `Split N` / `Merge N`. When exactly one entry has `mergedCount` N ≥ 2, `Split N` SHALL show. Otherwise, with N ≥ 2 entries that all have an `id`, `Merge N` SHALL show. From two entries the follow-up lane's `Clear all` SHALL also show. No confirmation.

#### Scenario: Pending steer appears at the bottom of chat
- **WHEN** `pendingQueues.steering` is `[{ id: "1", text: "focus on X", imageCount: 0 }]`
- **AND** the message list ends with an assistant message
- **THEN** `ChatView` SHALL render "focus on X" as a bubble after the assistant message, under a `Steering` group label with a spinner
- **AND** the bubble SHALL render a `pending-steer-cancel-1` control

#### Scenario: One label for several steers
- **WHEN** `pendingQueues.steering` holds four entries
- **THEN** exactly one group label reading `Steering · 4` SHALL render
- **AND** no bubble SHALL render its own `Steering` header

#### Scenario: Image count badge on a steer with images
- **WHEN** a steering entry has `imageCount: 2`
- **THEN** its bubble SHALL render `pending-steer-attachments` showing `2`

#### Scenario: Clear all from two entries
- **WHEN** `pendingQueues.steering` holds two entries
- **THEN** `pending-steer-clear-all` SHALL render below the stack
- **AND** with one entry it SHALL NOT render

#### Scenario: Merge control from two entries sends a merge
- **WHEN** `pendingQueues.steering` holds two entries with ids
- **THEN** `pending-steer-merge` reading `Merge 2` SHALL render beside `Clear all`
- **AND** clicking it SHALL send `merge_steering_entries { sessionId }`
- **AND** with one plain entry it SHALL NOT render

#### Scenario: Merged steer shows Split
- **WHEN** `pendingQueues.steering` is `[{ id: "M", text: "a\n\nb", imageCount: 0, mergedCount: 2 }]`
- **THEN** the group label SHALL read `Steering · merged`
- **AND** `pending-steer-split` reading `Split 2` SHALL render and `pending-steer-merge` SHALL NOT
- **AND** clicking it SHALL send `split_steering_entry { sessionId, id: "M" }`

#### Scenario: Merged plus plain shows Merge only
- **WHEN** `pendingQueues.steering` is a merged entry (`mergedCount: 2`) followed by one plain entry
- **THEN** `pending-steer-merge` reading `Merge 2` SHALL render
- **AND** `pending-steer-split` SHALL NOT render

#### Scenario: Cancel sends a remove by id
- **WHEN** the user clicks `pending-steer-cancel-1`
- **THEN** the client SHALL send `remove_steering_entry { sessionId, id: "1" }`
- **AND** no confirmation dialog SHALL open

#### Scenario: Steer chip disappears when the buffer clears
- **WHEN** `pendingQueues.steering` transitions from one entry to `[]`
- **THEN** the inline bubble and the group label SHALL disappear

### Requirement: Client tolerates legacy string steering entries

For one release the client SHALL accept `pendingQueues.steering` elements that are plain strings, rendering each as a bubble under the `Steering` group label with `imageCount: 0` and no cancel control (no `id` to target). Merge SHALL NOT be offered while any legacy entry is shown.

#### Scenario: Legacy string entry renders without cancel
- **WHEN** `pendingQueues.steering` is `["focus on X"]`
- **THEN** `ChatView` SHALL render a bubble for "focus on X" under the `Steering` group label
- **AND** the bubble SHALL NOT render a cancel control

#### Scenario: No merge with any legacy entry
- **WHEN** `pendingQueues.steering` is `["a", { id: "2", text: "b", imageCount: 0 }]`
- **THEN** `pending-steer-merge` SHALL NOT render
