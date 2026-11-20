## MODIFIED Requirements

### Requirement: Server caches per-session queue state from `queue_update` events

The server SHALL maintain a per-session `pendingQueues: { steering: string[]; steeringImageCounts?: number[]; followUp: FollowUpEntryView[] }` field inside `SessionUiState`, where `FollowUpEntryView = { text: string; imageCount: number }`. The field SHALL be updated whenever a `queue_update` ExtensionToServerMessage arrives from a bridge for that session. The server SHALL include `pendingQueues` in every `session_updated` broadcast and in the initial-state replay sent on browser subscribe.

The server SHALL forward `followUp` entries verbatim and SHALL NOT inspect, rewrite, or validate their fields. `steering` remains `string[]` (pi-owned, display-only). `steeringImageCounts`, when present, is a parallel array of non-negative integers, one per `steering` element; the server SHALL keep it only when its length equals `steering.length` and otherwise drop it. Image bytes SHALL NOT appear in either field.

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

#### Scenario: Steer image counts round-trip
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: ["look"], steeringImageCounts: [2], followUp: [] }`
- **THEN** the server SHALL set `pendingQueues.steering` to `["look"]` and `pendingQueues.steeringImageCounts` to `[2]`
- **AND** the broadcast SHALL carry both unmodified and no image `data`

#### Scenario: Misaligned image counts are dropped
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: ["a", "b"], steeringImageCounts: [1], followUp: [] }`
- **THEN** the server SHALL set `pendingQueues.steering` to `["a", "b"]`
- **AND** `pendingQueues.steeringImageCounts` SHALL be absent

#### Scenario: Older bridge omits the counts
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: ["a"], followUp: [] }` with no `steeringImageCounts`
- **THEN** the server SHALL cache `pendingQueues` without `steeringImageCounts` and broadcast it unchanged

#### Scenario: Empty arrays clear the cache slot
- **WHEN** a bridge sends `queue_update { sessionId: "S", steering: [], followUp: [] }`
- **THEN** the server SHALL set `SessionUiState[S].pendingQueues = { steering: [], followUp: [] }`
- **AND** the server SHALL broadcast `session_updated`

#### Scenario: Reconnect replays the cached state
- **WHEN** a browser subscribes to session "S" whose `pendingQueues` is non-empty
- **THEN** the initial-state snapshot SHALL include the current `pendingQueues` value
- **AND** the client SHALL render chips for both arrays without waiting for a fresh `queue_update`

### Requirement: Bridge maintains shadow steering and follow-up queues

Pi's ExtensionAPI does not forward `queue_update` events to extensions (re-verified through pi 1.3.0: neither `types.d.ts` nor `runner.js` mentions `queue_update`). The bridge SHALL maintain two distinct per-session in-memory structures with different ownership semantics:

- **`bridgeSteering: SteerEntry[]` (pi-OWNED + SHADOW)**, where `SteerEntry = { text: string; imageCount: number; images?: ImageContent[] }` — mirrors pi's `Agent.steeringQueue`. `imageCount` is the number of VALID images sent with the steer; `images` retains those same validated objects BY REFERENCE (pi holds them in its own queue) solely so a headless steer cancel can re-send them; they are released when the entry is spliced and never appear in `queue_update`. Mutated only by `recordSteerSent(text, images?)` (on bridge-originated steer sends), the headless cancel commit, + drain-by-`message_start`-matcher (when pi delivers a queued steer entry, the matching text is spliced).
- **`bridgeFollowUp: FollowUpEntry[]` (BRIDGE-OWNED BUFFER)** — authoritative store for dashboard-originated follow-up entries while the agent is streaming, where `FollowUpEntry = { text: string; images?: ImageContent[] }`. Pi never sees these entries until the drain loop ships them on `agent_settled`. Mutated by `bufferFollowupSend` (on push), `enqueueSystemFollowup` (on system push), `drainFollowupQueue` (on pop), and the four mutation handlers (`edit_followup_entry`, `remove_followup_entry`, `promote_followup_entry`, `clear_followup_entries`).

An entry's images SHALL be stored on the entry itself, never in a parallel index-keyed structure, so that every splice/unshift/shift preserves the text↔images association structurally.

Both structures feed the same `queue_update { sessionId, steering: [...], followUp: [...] }` ExtensionToServerMessage, where each `followUp` element is projected to `{ text, imageCount }`, `steering` is the list of `SteerEntry.text`, and `steeringImageCounts` is the parallel list of `SteerEntry.imageCount` (omitted when every count is 0). Image bytes SHALL NOT be included in `queue_update`. The server caches the snapshot and broadcasts to subscribed browsers.

**Session-change reset:** session-change events (new / fork / resume) SHALL reset both arrays to `[]` and emit `queue_update` once. Different session — old state is meaningless. Buffered image bytes are released with the entries.

**Bridge restart:** both structures are in-memory only; bridge process restart (`/reload`, dashboard restart, pi crash) loses them, including any buffered or retained image bytes. Symmetric with pi's own queue behavior.

#### Scenario: Bridge records a steer mid-stream
- **WHEN** the agent is streaming
- **AND** the bridge sends `pi.sendUserMessage("focus on X", {deliverAs:"steer"})`
- **THEN** the bridge SHALL append `"focus on X"` to `bridgeSteering`
- **AND** the bridge SHALL emit `queue_update { steering: [...], followUp: [...] }`

#### Scenario: Image-bearing steer records its count
- **WHEN** the agent is streaming
- **AND** the bridge sends a steer with text "see this" and 2 valid images
- **THEN** `bridgeSteering` SHALL gain `{ text: "see this", imageCount: 2 }`
- **AND** `queue_update` SHALL carry `steering: [..., "see this"]` and a `steeringImageCounts` whose last element is `2`

#### Scenario: Dropped images are not counted
- **WHEN** a steer arrives with 2 images of which 1 fails validation
- **THEN** the recorded `imageCount` SHALL be `1`

#### Scenario: Per-entry steering drain via message_start matcher
- **WHEN** `bridgeSteering` texts are `["a", "b", "c"]`
- **AND** pi drains `"a"` by emitting user `message_start` with content `"a"` at `turn_end`
- **THEN** the bridge SHALL set `bridgeSteering` texts to `["b", "c"]` (their image counts preserved)
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

#### Scenario: Steer entry retains images by reference until spliced
- **WHEN** `recordSteerSent("look", [img])` runs while streaming
- **THEN** the entry SHALL hold `images: [img]` and `imageCount: 1`
- **AND** `queue_update` SHALL carry `steeringImageCounts: [1]` and no image bytes
- **AND** when the matcher splices the entry its `images` reference SHALL be released

### Requirement: Steer queue is permanently pi-owned + display-only — no bridge-owned-steer

Pi SHALL remain the sole owner of the steer queue. The dashboard SHALL NOT introduce a bridge-owned steer buffer, SHALL NOT call any `pi.clear*Queue` from the bridge, and SHALL NOT offer steer edit/promote/pull. The single exception is per-entry CANCEL on HEADLESS (keeper-spawned `--mode rpc`) sessions, performed by the server via pi RPC `clear_queue` + re-send (see "Headless steer cancel clears pi's queue and re-sends the remainder"). All other sessions stay display-only. Steer entries render inline in `ChatView` as ghost bubbles, not in `QueuePanel`.

**Rationale**: Steer drains at every `turn_end` (1-15 s), so only a short cancel window exists; it is still worth serving on headless sessions, where pi's RPC mode exposes `clear_queue` (the ExtensionAPI still does not). Pi-TUI has no per-steer edit, so TUI/tmux sessions get none.

The bridge SHALL track `bridgeSteering` as a SHADOW (mirrors pi's `Agent.steeringQueue`) via:

- `recordSteerSent(text, images?)`: bridge-originated steer pushes append to `bridgeSteering` only when `getBridgeState().isAgentStreaming === true` (capture-before-send pattern; mid-flight `pi.sendUserMessage` flips `isAgentStreaming` synchronously on idle sends, so we capture pre-send to avoid false chips).
- Drain-by-`message_start`-matcher: when pi delivers a queued steer at `turn_end`, the matching text is spliced from `bridgeSteering` (FIFO first-occurrence removal).

The Stop button calls `cachedCtx.abort()` only — pi's steer queue persists across abort by design.

#### Scenario: No steer mutation messages exist in the wire protocol
- **WHEN** the wire protocol (`packages/shared/src/protocol.ts`, `browser-protocol.ts`) is examined for steer-mutation message types
- **THEN** there SHALL be no `clear_steering_queue`, `edit_steering_entry`, `remove_steering_entry`, or `promote_steering_entry` types
- **AND** the only steer-mutating messages SHALL be `cancel_steer_entry` (browser→server), `cancel_steer_prepare` / `cancel_steer_commit` (server→bridge) and the results `steer_cancel_prepared` / `steer_cancel_result`
- **AND** the bridge SHALL NOT call `pi.clearSteeringQueue`, `pi.clearFollowUpQueue` or `pi.clearAllQueues`

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

#### Scenario: Non-headless session has no steer cancel
- **WHEN** a TUI or tmux session shows a pending steer
- **THEN** no cancel control SHALL render and the server SHALL answer a `cancel_steer_entry` for it with `unsupported`

## ADDED Requirements

### Requirement: Pending steer bubble indicates attached images

The pending-steer ghost bubble in `ChatView` SHALL render an attachment indicator, carrying `data-testid="pending-steer-attachments"`, when its entry's count in `pendingQueues.steeringImageCounts` is greater than 0, showing the count with the same icon and `session.attachedImages` title as `queue-followup-attachments`. It SHALL NOT render thumbnails. A missing array or a 0 count SHALL render the bubble unchanged.

#### Scenario: Bubble shows the count for an image-bearing steer
- **WHEN** `pendingQueues` is `{ steering: ["look"], steeringImageCounts: [2], followUp: [] }`
- **THEN** the bubble SHALL display "look"
- **AND** `pending-steer-attachments` SHALL be present and show 2
- **AND** no image thumbnail SHALL be rendered

#### Scenario: Text-only steer is unchanged
- **WHEN** `pendingQueues` is `{ steering: ["plain"], steeringImageCounts: [0], followUp: [] }`
- **THEN** `pending-steer-attachments` SHALL NOT be present

#### Scenario: Older payload without counts
- **WHEN** `pendingQueues` is `{ steering: ["plain"], followUp: [] }`
- **THEN** the bubble SHALL render with no indicator and no error

#### Scenario: Count follows its entry after a partial drain
- **WHEN** `steering` is `["a", "b"]` with `steeringImageCounts: [0, 3]` and pi drains `"a"`
- **THEN** the remaining bubble "b" SHALL show count 3

### Requirement: Headless steer cancel clears pi's queue and re-sends the remainder

For a headless session the server SHALL cancel one pending steer by (1) asking the bridge to `cancel_steer_prepare`, (2) writing pi RPC `{"type":"clear_queue"}` then one `{"type":"steer","message","images"?}` per remaining entry, in order, on ONE keeper connection, then (3) sending `cancel_steer_commit` so the bridge splices the entry and emits `queue_update`. Nothing SHALL be mutated unless step 2 succeeded.

#### Scenario: Cancel the middle of three steers
- **WHEN** `bridgeSteering` is `[a, b(1 image), c]` and the user cancels `b`
- **THEN** the bridge SHALL reply `steer_cancel_prepared { status: "ok", remaining: [a, c] }` and SHALL NOT yet mutate its shadow
- **AND** the server SHALL write `clear_queue`, `steer a`, `steer c` in that order
- **AND** after `cancel_steer_commit` the next `queue_update` SHALL carry `steering: ["a","c"]` and the result SHALL be `cancelled`

#### Scenario: Remaining entry keeps its images
- **WHEN** the entries kept for re-send include one with images `[img]`
- **THEN** its `steer` line SHALL carry `images: [img]` with the same `{type:"image",data,mimeType}` blocks
- **AND** no image bytes SHALL be logged or cached by the server

#### Scenario: Entry already delivered
- **WHEN** the bridge matcher already spliced the entry, or `bridgeSteering[index].text` differs from the request `text`, or the agent is not streaming
- **THEN** the bridge SHALL reply `status: "already_delivered"` and the server SHALL write nothing
- **AND** the browser result SHALL be `already_delivered` (a no-op, shown as "already sent")

#### Scenario: Keeper write fails
- **WHEN** the keeper socket is missing, refuses, or does not flush within 2 s
- **THEN** the result SHALL be `failed`, no `cancel_steer_commit` SHALL be sent, and the bridge shadow SHALL be unchanged
- **AND** an uncommitted prepare SHALL expire after 10 s

#### Scenario: Re-send would alter text
- **WHEN** any remaining entry text starts with `/`
- **THEN** the bridge SHALL reply `status: "unresendable"` and nothing SHALL be written (RPC `steer` expands skill/template text; the bridge path does not)

#### Scenario: Concurrent cancels are serialised
- **WHEN** a second `cancel_steer_entry` arrives for a session whose cancel is in flight
- **THEN** the server SHALL answer it `busy` without touching the keeper

#### Scenario: Residual drain race is documented, not hidden
- **WHEN** another entry drains at `turn_end` between the bridge snapshot and the keeper write
- **THEN** that entry MAY be delivered twice (pi's `clear_queue` response, which would prevent this, is discarded by the keeper)
- **AND** the design SHALL record this as accepted

### Requirement: Pending steer bubble offers cancel on headless sessions

The pending-steer ghost bubble SHALL render a cancel button (`data-testid="pending-steer-cancel"`, accessible name from `session.cancelSteer`) only when the parent supplies a cancel handler, which it SHALL do only for sessions whose `source` is `"dashboard"`. The button SHALL be disabled while a cancel is pending, and an `already_delivered`/`failed`/`unresendable`/`busy` result SHALL surface a message.

#### Scenario: Headless session shows the button
- **WHEN** the session `source` is `"dashboard"` and `pendingQueues.steering` is `["a","b"]`
- **THEN** each bubble SHALL render `pending-steer-cancel`
- **AND** clicking the second SHALL send `cancel_steer_entry { index: 1, text: "b" }`

#### Scenario: Non-headless session shows none
- **WHEN** the session `source` is `"tui"` or `"tmux"`
- **THEN** no `pending-steer-cancel` SHALL render

#### Scenario: Already-delivered result
- **WHEN** the result is `already_delivered`
- **THEN** the UI SHALL show a non-error "already sent" message and the button SHALL re-enable or vanish with the bubble
