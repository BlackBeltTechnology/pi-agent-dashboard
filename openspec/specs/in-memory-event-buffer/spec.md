## Purpose

In-memory per-session event buffer for the dashboard server: stores forwarded
`DashboardEvent`s, serves them for replay, bounds memory via a per-session event
cap and LRU session eviction.
## Requirements
### Requirement: In-memory event storage
The dashboard server SHALL store events in an in-memory `Map<sessionId, { events: StoredEvent[], lastAccess: number }>` instead of SQLite. The EventStore interface (`insertEvent`, `getEvents`, `getEvent`, `deleteEventsForSession`, `hasEvents`, `sessionCount`) SHALL be preserved so consumers (browser-gateway, server) remain unchanged. The EventStore SHALL additionally expose `getMaxSeq(sessionId): number` to return the highest stored sequence number for a session.

#### Scenario: Event insertion
- **WHEN** an event arrives from a bridge extension for session "abc"
- **THEN** the server SHALL assign the next sequence number, store the event in the in-memory buffer for that session, and update `lastAccess` to the current timestamp

#### Scenario: Event retrieval for replay
- **WHEN** a browser subscribes with `lastSeq: 50` for session "abc"
- **THEN** the server SHALL return all events with seq > 50 from the in-memory buffer

#### Scenario: Full replay
- **WHEN** a browser subscribes with no `lastSeq` for session "abc"
- **THEN** the server SHALL return all events from the in-memory buffer for that session

#### Scenario: Delete events for session
- **WHEN** a bridge reconnects and the server determines a full wipe is needed (eventCount mismatch or no eventCount provided)
- **THEN** the server SHALL clear the in-memory buffer for that session

#### Scenario: Skip delete when eventCount matches
- **WHEN** a bridge reconnects with matching `eventCount`
- **THEN** the server SHALL NOT clear the in-memory buffer for that session

#### Scenario: Fetch single event
- **WHEN** a browser requests a specific event by sessionId and seq
- **THEN** the server SHALL return the event from the in-memory buffer, or undefined if not found

#### Scenario: Get max sequence number
- **WHEN** the subscription handler needs to detect stale `lastSeq`
- **THEN** `getMaxSeq(sessionId)` SHALL return the highest seq in the buffer, or `0` if no events exist

### Requirement: LRU eviction policy
The in-memory event buffer SHALL enforce a maximum number of cached sessions (default 100, configurable). When the limit is exceeded, the least-recently-accessed ended sessions with zero browser subscribers SHALL be evicted.

#### Scenario: Eviction triggers on insert
- **WHEN** an event is inserted and the total cached session count exceeds `MAX_CACHED_SESSIONS`
- **THEN** the server SHALL evict the least-recently-accessed session that is ended and has zero browser subscribers

#### Scenario: Active sessions are never evicted
- **WHEN** eviction runs and a session has an active bridge connection
- **THEN** that session SHALL NOT be evicted regardless of `lastAccess`

#### Scenario: Subscribed sessions are never evicted
- **WHEN** eviction runs and a session has browser subscribers
- **THEN** that session SHALL NOT be evicted regardless of `lastAccess`

#### Scenario: Evicted session re-requested
- **WHEN** a browser subscribes to a session whose events were evicted
- **THEN** the server SHALL trigger on-demand loading via bridge (see on-demand-session-replay spec)

#### Scenario: lastAccess updated on read
- **WHEN** events are read for a session (getEvents or getEvent)
- **THEN** the `lastAccess` timestamp SHALL be updated to prevent premature eviction

### Requirement: Image data preservation during truncation
The generic per-string-field truncation pass (`truncateStrings`) SHALL preserve base64 image data fields: when a key is `"data"` and its parent object carries a sibling mime key, the value SHALL NOT be truncated. Capping base64 does not yield a smaller image, it yields a string that no longer decodes.

The sibling-mime test SHALL be the shared `inline-image-block-shapes` structural
predicate, covering BOTH shapes — flat `mimeType` and the nested Anthropic
`source` wrapper's `media_type` — so a nested-shape image is exempt exactly as a
flat one is. The predicate SHALL NOT be re-implemented locally in the store.

This exemption is scoped to the generic per-string-field pass for NON-subagent
events. It SHALL NOT apply to:

- **the subagent-timeline reduction**, which is TYPE-scoped, SKIPS the generic
  pass entirely, and deliberately head+tail-caps image `.data` with NO
  preservation — a subagent event's timeline budget takes precedence over any
  single image it embeds;
- **the per-event total-serialized-size ceiling**, which is a separate bound:
  when the event as a whole is over the ceiling, the chat-message image-bytes
  rescue defined by that requirement takes precedence and the image bytes are
  stripped.

#### Scenario: Image base64 data preserved
- **WHEN** a `message_start` event contains a user message with an image content block `{ type: "image", data: "<base64>", mimeType: "image/png" }` and the event as a whole is within `MAX_EVENT_DATA_SIZE`
- **THEN** the event store SHALL store the full `data` string without truncation

#### Scenario: Per-field exemption does not defeat the ceiling
- **WHEN** the same image block makes the event exceed `MAX_EVENT_DATA_SIZE`
- **THEN** the per-field exemption SHALL NOT keep the bytes: the image-bytes
  rescue SHALL strip them and the stored event SHALL be within the ceiling

#### Scenario: Nested-shape image data is preserved too
- **WHEN** an under-ceiling event carries `{ type: "image", source: { type: "base64", media_type: "image/png", data: "<base64>" } }` and the base64 exceeds the per-string-field cap
- **THEN** `source.data` SHALL be stored verbatim, NOT head+tail-capped

#### Scenario: Subagent reduction is not covered by the exemption
- **WHEN** an over-ceiling subagent-timeline event embeds a flat image block
- **THEN** the subagent reduction SHALL still cap that image `.data` — the
  exemption SHALL NOT keep it whole and starve the timeline budget

#### Scenario: Non-image data fields still truncated
- **WHEN** an event contains an object with `{ data: "<large string>" }` but no `mimeType` key
- **THEN** the `data` field SHALL be truncated per the normal max string size limit

#### Scenario: Other string fields still truncated alongside images
- **WHEN** a `message_start` event contains both an image content block and a large `thinking` field
- **THEN** the `data` field in the image block SHALL be preserved AND the `thinking` field SHALL be truncated normally

### Requirement: Subscriber-count awareness for pinning
The in-memory event store SHALL receive an `isSessionPinned(sessionId): boolean` callback at creation time. The callback SHALL return true when a session has an active bridge connection OR has browser subscribers > 0. Pinned sessions SHALL never be evicted.

#### Scenario: Pinning callback injected at creation
- **WHEN** the memory event store is created
- **THEN** it SHALL accept an `isSessionPinned` callback parameter

#### Scenario: Pinned session skipped during eviction
- **WHEN** eviction runs and `isSessionPinned("abc")` returns true
- **THEN** session "abc" SHALL be skipped and the next evictable session considered

### Requirement: Per-session trim preserves the chat transcript head
The in-memory event buffer SHALL bound each session to `maxEventsPerSession`
events (default 20000, `0` = unlimited). When the buffer exceeds the cap, the
store SHALL drop the OLDEST non-essential event first, where essential chat
events are exactly `message_start` and `message_end`. Essential events SHALL be
retained unless the essential events alone exceed the cap, in which case the
OLDEST essential event SHALL be dropped only to hold the memory bound. Trimming
SHALL NOT renumber surviving events; `getEvents` filters by seq and tolerates
seq gaps.

#### Scenario: Chat head survives a subagent flood
- **GIVEN** a session whose first two stored events are `message_start` (seq 1)
  and `message_end` (seq 2)
- **WHEN** a subagent turn forwards thousands of `tool_execution_*` /
  `subagent_*` events that push the buffer past the cap
- **THEN** seq 1 and seq 2 SHALL still be present and the dropped events SHALL be
  the oldest non-essential events

#### Scenario: Non-essential dropped before essential
- **GIVEN** a buffer at the cap containing both `message_start`/`message_end` and
  `tool_execution_start` events
- **WHEN** a new event is inserted over the cap
- **THEN** the oldest `tool_execution_start` SHALL be dropped and no
  `message_start`/`message_end` SHALL be dropped

#### Scenario: Essential-only overflow falls back to oldest essential
- **WHEN** the buffer holds only `message_start`/`message_end` events and their
  count exceeds the cap
- **THEN** the store SHALL drop the oldest essential events until the count
  equals the cap

### Requirement: Trim reclaim is amortized O(1) via hysteresis
The store SHALL NOT run a reclaim pass on every over-cap insert. It SHALL allow
the buffer to overshoot the cap by a `TRIM_SLACK` margin
(`min(256, floor(maxEventsPerSession * 0.05))`) and, only when the length
exceeds `cap + TRIM_SLACK`, reclaim back to the cap in a single O(n) pass. The
buffer length SHALL never exceed `cap + TRIM_SLACK`.

#### Scenario: Buffer stays bounded under a large flood
- **GIVEN** a session with cap 500 (TRIM_SLACK 25)
- **WHEN** 10000 non-essential events are inserted
- **THEN** the buffer length SHALL be ≤ 525 at all observable points and the
  reclaim SHALL run roughly once per `TRIM_SLACK` inserts, not once per insert

#### Scenario: Bulk history load stays linear
- **WHEN** a session is reopened and every replayed event is inserted through
  `insertEvent` in a loop
- **THEN** the total trim work SHALL be O(events) (amortized), NOT O(events × cap)

### Requirement: Per-event total-serialized-size ceiling
The in-memory event store SHALL bound the total serialized size of every
individual event's `data` to `MAX_EVENT_DATA_SIZE` (default
`DEFAULT_MAX_EVENT_DATA_SIZE` = 262 144 bytes / 256 KiB, constructor-injectable —
smaller values such as 20 000 appear only in tests, `0` = disabled). If an event's `data` exceeds the
ceiling, the store SHALL bound the event as follows:

- **Subagent-timeline events** — an event is a subagent-timeline event ONLY when
  it is TYPE-scoped as one (`data.toolName === "Agent"`, or an event type of
  `tool_execution_update`/`tool_execution_end` carrying a `details.agentId`) AND
  an `entries[]` array is reachable at `data.partialResult.details.entries` or
  `data.details.entries`. A bare array at those paths on an unrelated event SHALL
  NOT qualify. Such an event SHALL be DETECTED on the original event BEFORE the
  generic per-string-field pass, and the generic pass SHALL be SKIPPED for it (so
  the generic "array longer than the array-length limit collapses to a string"
  rule can NEVER clobber `entries[]`, independent of the per-string-field cap
  value). It SHALL be reduced by a **head+tail** strategy rather than replaced
  wholesale: keep the first-K + last-K entries, splice the removed middle into a
  single `text` **sentinel** entry (e.g. `{ kind: "text", text: "⋯ N steps hidden ⋯", ts }`)
  — NOT a new wire kind, so every client version renders it as plain text — and
  shrink oversized kept entries by a **per-ENTRY** budget enforced at the ENTRY
  level (each kept entry's total serialized bytes ≤ its budget), NOT by a
  per-string-leaf cap (so a `tool` entry whose `input` is an object with many
  string leaves cannot exceed its budget). Because large strings OUTSIDE
  `entries[]` would otherwise consume the whole ceiling and starve the timeline —
  the subagent task `data.args.prompt`, `details.description`, AND every string
  inside `data.partialResult.content[*]` (both `.text` AND base64 image `.data`,
  recursing container blocks) — the reduction SHALL first head+tail-cap ALL of
  them to bounded caps (NO image preservation on this path), then derive the
  per-entry budget from the MEASURED post-cap envelope. The reduction SHALL return
  a NEW event object with the touched paths cloned; it SHALL NOT mutate the
  in-flight `event`. All non-timeline `data` fields (other than the capped
  strings) SHALL be left intact. If the event cannot be brought under the ceiling
  this way (e.g. an empty `entries[]` with an already-capped but still-oversized
  envelope), the store SHALL fall back to the bounded `{ __truncated }`
  placeholder.
- **Chat-message events carrying inline image bytes** — when the over-ceiling
  event's `data.message.content` is an array containing at least one INLINE image
  block (a block recognized by the shared `inline-image-block-shapes` detector as
  carrying non-empty base64 bytes, in EITHER the flat pi shape
  `{ type: "image", data, mimeType }` or the nested Anthropic shape
  `{ type: "image", source: { type: "base64", media_type, data } }`), the store
  SHALL first strip ONLY those image bytes rather than replacing the whole event.
  The message envelope SHALL be preserved: `message.role`, every non-image block
  verbatim, and each image block's POSITION in `content[]` and its mime
  (flat `mimeType`, nested `source.media_type` with the `source` wrapper intact).
  The stripped block's bytes SHALL be replaced with an empty string and the block
  SHALL be marked `imageTruncated: true`. That marker is the CLIENT CONTRACT for
  the rescued block: unlike a two-phase placeholder it carries no `attachmentId`
  and no resolution will ever arrive for it, so the client SHALL render it as an
  explicit unavailable slot (see the `event-reducer` and
  `inline-image-block-shapes` requirements). A rescued block SHALL NOT be dropped
  from the rendered message merely because it has no bytes and no `attachmentId`.

  The rescue SHALL NOT exempt the rescued message from the generic
  per-string-field cap: a rescued message's text blocks SHALL be capped by the
  SAME universal rule as any other message's, so the per-field bound does not
  depend on whether a message happened to carry an image. What the rescue changes
  is the ALTERNATIVE for that row — the whole-event placeholder, i.e. total loss
  of the message — not the cap. This rescue SHALL run BEFORE the generic
  per-string-field pass and BEFORE the `{ __truncated }` fallback, and SHALL run
  ONLY on an event already measured as over the ceiling — an under-ceiling event's
  image bytes SHALL be left untouched so ordinary inline rendering is unaffected.
  The rescue SHALL return a NEW event object with only the touched paths cloned;
  it SHALL NOT mutate the in-flight `event`, and SHALL return the original
  reference when it changed nothing. The rescue is NOT a ceiling exemption: after
  it runs, the terminal bound check still applies, so an event whose NON-image
  content alone remains over the ceiling SHALL still fall through to the
  `{ __truncated }` placeholder.

  Rationale: the whole-event placeholder erases `data.message` entirely. For a
  user chat message with a pasted screenshot that means the client's
  `message_start` handler sees no `message.role`, creates no user row, and the
  message VANISHES from history — the user's text along with the image.
- **All other events** — the store SHALL replace `event.data` with a bounded
  placeholder that preserves `eventType` and records the truncation.

The per-string-field truncation SHALL preserve BOTH the head and the tail of an
over-long string (first half + a `…hidden…` marker + last half), not the head
only. All size measurement — both step-wise pruning AND the final bound proof —
SHALL use a byte-accurate, bounded-cost, early-exit walk that (a) counts each
string's ACTUAL JSON-serialized byte length (UTF-8 width + escape expansion), not
its code-unit length; (b) counts a base64 image `data` string at its real size,
not a fixed constant; (c) short-circuits a huge string via the code-unit lower
bound (UTF-8 bytes ≥ UTF-16 units) so it need not scan it; and (d) stops once the
running total crosses the ceiling. The store SHALL NOT materialize a full
`JSON.stringify` of `event.data` anywhere on the persist/broadcast path (including
any terminal bound check). The ceiling SHALL be enforced at ingest so both
persistence (`insertEvent`) and broadcast (`broadcastEvent`) operate on the
already-bounded event.

#### Scenario: Oversized subagent event is bounded before storage
- **GIVEN** an event whose `data` embeds a subagent's full timeline and exceeds
  `MAX_EVENT_DATA_SIZE` after per-field truncation
- **WHEN** the event is inserted
- **THEN** the stored event's serialized size SHALL be ≤ `MAX_EVENT_DATA_SIZE`
  plus a small constant — achieved by the head+tail reduction (keeping the first
  and last entries + a `text` sentinel) or, when the event is unreducible, the
  bounded `{ __truncated }` placeholder

#### Scenario: Oversized subagent event keeps first and last entries
- **GIVEN** an event whose `data` embeds a subagent's full timeline of many
  entries and exceeds `MAX_EVENT_DATA_SIZE` after per-field truncation
- **WHEN** the event is inserted
- **THEN** the stored event's `data` SHALL still carry an `entries[]` array
  containing the first entries, a `text` sentinel entry whose text names the hidden
  count, and the last entries (including the final result), NOT a scalar
  `{ __truncated }` placeholder
- **AND** the stored event's ACTUAL serialized byte size SHALL be
  ≤ `MAX_EVENT_DATA_SIZE` plus a small constant

#### Scenario: Large non-entries string does not starve the timeline
- **GIVEN** an over-ceiling subagent event where any of `data.args.prompt`,
  `details.description`, or `data.partialResult.content[*].text` is large enough
  that, uncapped, it would leave no room for `entries[]`
- **WHEN** the event is inserted
- **THEN** each of those strings SHALL be head+tail-capped to its bounded cap, the
  reduced `entries[]` SHALL still retain the first and last entries (the timeline
  is not starved), and the serialized `data` SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus
  a small constant

#### Scenario: Shape-only match does not trigger reduction (no false positive)
- **GIVEN** an over-ceiling event that is NOT a subagent tool event (no
  `toolName === "Agent"`, no `details.agentId`) but happens to carry an array at
  `data.details.entries`
- **WHEN** the event is inserted
- **THEN** the store SHALL NOT head+tail-reduce that array or cap its strings, and
  SHALL bound the event via the `{ __truncated }` placeholder like any other
  non-subagent event

#### Scenario: Byte-accurate bound holds for escape/multi-byte-heavy input
- **GIVEN** an over-ceiling subagent event whose entries/strings are dominated by
  characters that expand under JSON serialization (quotes, backslashes, control
  chars) or UTF-8 multi-byte characters (CJK, emoji)
- **WHEN** the event is inserted
- **THEN** the stored event's ACTUAL serialized byte size
  (`Buffer.byteLength(JSON.stringify(data))`, computed by the TEST) SHALL be
  ≤ `MAX_EVENT_DATA_SIZE` plus a small constant — a code-unit-only estimate SHALL
  NOT be relied on as the bound

#### Scenario: Base64 image does not OOM the reduction or broadcast
- **GIVEN** an over-ceiling subagent event carrying a multi-megabyte base64 image
  (an `{ data, mimeType }` block) inside `data.partialResult.content[*]` or inside
  a kept entry
- **WHEN** the event is inserted
- **THEN** the image `data` string SHALL be head+tail-capped (or the event SHALL
  fall back to `{ __truncated }`), the store SHALL NOT materialize a full
  `JSON.stringify` of the multi-megabyte payload, and the stored event's actual
  serialized byte size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus a small constant

#### Scenario: Image-bearing chat message is bounded by stripping only the image bytes
- **GIVEN** a non-subagent `message_start` whose `data.message.content` holds a
  text block and a flat-shape image block whose base64 pushes the event over the
  ceiling (and such that a code-unit estimate would under-count it)
- **WHEN** the event is inserted
- **THEN** the byte-accurate walk SHALL count the image at its real size and
  detect the event as over-ceiling — the event SHALL NOT be stored at full size
- **AND** the stored `data` SHALL NOT be the `{ __truncated }` placeholder:
  `data.message.role` SHALL still be `"user"`, the text block SHALL be preserved
  verbatim, and the image block SHALL still occupy its original position with its
  `mimeType` intact, `data: ""`, and `imageTruncated: true`
- **AND** the stored event's byte-accurate serialized size SHALL be
  ≤ `MAX_EVENT_DATA_SIZE` plus a small constant
- **AND** the rescued block SHALL remain renderable by the client as an
  unavailable slot — the image SHALL NOT silently disappear from the row

#### Scenario: Nested Anthropic image shape is rescued the same way
- **GIVEN** an over-ceiling `message_start` whose image block is the nested shape
  `{ type: "image", source: { type: "base64", media_type, data } }`
- **WHEN** the event is inserted
- **THEN** the message SHALL survive exactly as in the flat case: `source.data`
  SHALL be emptied, the `source` wrapper and `source.media_type` SHALL be
  preserved, the block SHALL be marked `imageTruncated: true`, and the stored
  event SHALL be within the ceiling
- **AND** the event SHALL NOT fall through to the `{ __truncated }` placeholder
  merely because the bytes are not at the top level of the block

#### Scenario: Non-image content over the ceiling still yields the placeholder
- **GIVEN** an over-ceiling `message_start` whose TEXT block alone exceeds the
  ceiling (with the per-string-field pass disabled so the text is not shortened),
  alongside a small image block
- **WHEN** the event is inserted
- **THEN** the image-bytes rescue SHALL NOT be sufficient and the store SHALL
  replace `data` with the bounded `{ __truncated }` placeholder
- **AND** the stored event SHALL be within the ceiling

#### Scenario: Rescued text is capped identically to unrescued text
- **GIVEN** two `message_start` events with the SAME over-cap text block, one
  plain and one whose inline image pushes it over the ceiling
- **WHEN** both are inserted
- **THEN** the stored text SHALL be identical for both — head+tail-capped with the
  hidden-count marker — and the rescued one SHALL NOT be exempted from the cap

#### Scenario: An under-ceiling message is not rescued
- **GIVEN** a `message_start` carrying an inline image whose event stays within
  `MAX_EVENT_DATA_SIZE`
- **WHEN** the event is inserted
- **THEN** the image bytes SHALL be stored intact and no `imageTruncated` marker
  SHALL be added

#### Scenario: The rescue does not mutate the in-flight event
- **GIVEN** an over-ceiling image-bearing `message_start` whose `data` object is
  also referenced by another observer (bridge / logger)
- **WHEN** the store rescues it at ingest
- **THEN** the store SHALL return a NEW event object and the caller's original
  `event.data.message.content` image bytes SHALL be unchanged

#### Scenario: A non-message image-bearing event still gets the placeholder
- **GIVEN** an over-ceiling non-subagent event that carries a large base64 image
  somewhere OTHER than `data.message.content` (no chat-message envelope to
  preserve)
- **WHEN** the event is inserted
- **THEN** the store SHALL replace `data` with the `{ __truncated }` placeholder
  and the stored event SHALL be within the ceiling

#### Scenario: Unreducible subagent event falls back to the placeholder
- **GIVEN** an over-ceiling subagent-timeline event with an empty `entries[]` and
  an envelope that remains over the ceiling even after all non-entries strings are
  capped
- **WHEN** the event is inserted
- **THEN** the store SHALL replace `data` with the bounded `{ __truncated }`
  placeholder and the stored serialized size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus
  a small constant

#### Scenario: Reduction does not mutate the in-flight event
- **GIVEN** an over-ceiling subagent event whose `data` object is also referenced
  by another observer (bridge / logger)
- **WHEN** the store reduces it at ingest
- **THEN** the store SHALL return a NEW event object and the caller's original
  `event.data` (its `args`, `details`, and `entries`) SHALL be unchanged

#### Scenario: Timeline array longer than the array-length limit is not clobbered
- **GIVEN** a subagent timeline event whose `entries[]` has more than 20 entries
- **WHEN** the event is truncated at ingest
- **THEN** `entries[]` SHALL be reduced head+tail (kept entries + `text` sentinel),
  and SHALL NOT be replaced with the string `"[array truncated]"`

#### Scenario: Per-field truncation keeps head and tail
- **GIVEN** a kept timeline entry whose stringified tool output exceeds the
  per-field cap
- **WHEN** the entry's fields are truncated
- **THEN** the resulting string SHALL contain both the head and the tail of the
  original separated by a `…hidden…` marker, and its length SHALL be bounded by
  the per-field cap plus the marker

#### Scenario: capString head+tail keeps a skill-invocation envelope parseable
- **GIVEN** an over-long string that is a `<skill name=".." location="..">…</skill>`
  invocation envelope
- **WHEN** `capString` truncates it
- **THEN** the closing `</skill>` tag (and the header + trailing args) SHALL remain
  intact so the client's skill-block parser still parses it — the head+tail change
  SHALL NOT sever the envelope

#### Scenario: An entry whose input is a many-leaf object stays within its per-ENTRY budget
- **GIVEN** a kept `tool` entry whose `input` is an OBJECT with many large string
  leaves (plus a large `output`)
- **WHEN** the entry is shrunk to its per-entry budget
- **THEN** the entry's TOTAL serialized bytes SHALL be bounded by its per-entry
  budget (the budget is enforced at the entry level, NOT as an independent
  per-string-leaf cap that would sum to leafCount × cap)

#### Scenario: Non-subagent oversized event is bounded by placeholder
- **GIVEN** an over-ceiling event whose `data` does NOT carry a subagent
  `entries[]` timeline
- **WHEN** the event is inserted
- **THEN** the stored event's `data` SHALL be replaced with a bounded placeholder
  (e.g. `{ __truncated: true, reason, approxBytes, eventType }`) and the stored
  event's serialized size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus a small constant

#### Scenario: Pathological single huge final entry still bounded
- **GIVEN** a subagent timeline whose reduction floor is reached (`K_TAIL` at its
  minimum) and the single kept final entry's stringified form is still large
- **WHEN** the event is inserted
- **THEN** the per-entry head+tail floor SHALL apply to that entry so the stored
  event's byte-accurate serialized size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus a
  small constant (falling back to the placeholder if even that is insufficient)

#### Scenario: Broadcast of an oversized event serializes a bounded message
- **GIVEN** an over-ceiling event arriving via `event_forward`
- **WHEN** the server broadcasts it to subscribers
- **THEN** the serialized broadcast message SHALL be bounded (built from the
  reduced/truncated stored event) and SHALL NOT trigger an unbounded `JSON.stringify`

#### Scenario: Size estimation does not itself allocate an unbounded string
- **GIVEN** an event `data` of arbitrarily large aggregate size (including a
  single multi-megabyte string field)
- **WHEN** the store measures whether it exceeds the ceiling (for detection, for
  the entries budget, AND for the terminal bound proof)
- **THEN** the measurement SHALL stop as soon as the running total crosses the
  ceiling — short-circuiting a huge string via its code-unit lower bound — and
  SHALL NOT materialize a full `JSON.stringify` of the object at any point

#### Scenario: Under-ceiling events are stored unchanged
- **GIVEN** an event whose `data` is within `MAX_EVENT_DATA_SIZE` after per-field
  truncation
- **WHEN** the event is inserted
- **THEN** the event SHALL be stored without any reduction or placeholder

### Requirement: Depth-limited truncation does not return deep sub-trees raw
The event store string truncation SHALL NOT return a value untruncated solely
because it sits beyond the recursion depth limit. At the depth limit, a string
SHALL be truncated to the max string size, and an array or object SHALL be
collapsed to a bounded marker (e.g. `"[truncated: deep]"`) rather than returned
whole. Base64 image data preservation (a `"data"` key with a sibling
`"mimeType"`) SHALL still apply before any depth-limit collapse.

#### Scenario: Deep nested payload is truncated, not smuggled through
- **GIVEN** an event whose `data` nests large strings/arrays deeper than the
  recursion depth limit
- **WHEN** the event is truncated at ingest
- **THEN** the deep sub-trees SHALL be truncated or collapsed to a bounded
  marker, not returned raw

#### Scenario: Deep image data still preserved
- **GIVEN** an image content block `{ data: "<base64>", mimeType: "image/png" }`
  nested beyond the depth limit
- **WHEN** the event is truncated
- **THEN** the image `data` SHALL be preserved and NOT collapsed

### Requirement: Superseded `tool_execution_update` events are collapsed at retention

The in-memory event buffer SHALL drop a retained `tool_execution_update` for a
`toolCallId` when a later update for the same `toolCallId` **subsumes** it, so
that in the common case exactly one update per `toolCallId` is retained.

Collapse SHALL be keyed strictly on `data.toolCallId`. An update event carrying
no `toolCallId` SHALL be retained unconditionally (fail-open).

**Subsumption test.** Let `p` be the currently retained update for a
`toolCallId` and `s` the incoming one. Resolve each event's subagent details as
`data.partialResult.details` ONLY — matching how the consumer reads an update. A
top-level `data.details` SHALL NOT be used to resolve an update's details.

- If NEITHER event carries resolved details, `s` SHALL subsume `p`
  (the consumer path is an unconditional overwrite).
- Otherwise `s` SHALL subsume `p` only when ALL of the following hold:
  - every key present in `p`'s details is also present in `s`'s details AND holds
    a value of the same JS type, because the consumer extracts each detail field
    type-conditionally;
  - when `p`'s `details.entries` is a non-empty array, `s`'s `details.entries` is
    also a non-empty array;
  - when `p` sets the rendered result, `s` SHALL also set it. An update sets the
    rendered result either by yielding extractable text from
    `partialResult.content` (a SIBLING of `details`) or by carrying a non-object
    `partialResult`, which the consumer renders directly. Both sources SHALL be
    considered; `content` is NOT the only one.
- When `s` does not subsume `p`, BOTH SHALL be retained.

The subsumption test SHALL compare the key SET generically. It SHALL NOT
enumerate a hardcoded list of detail field names, so a field added to the
consumer later is covered without changing this policy.

**Creating-tick retention.** The FIRST update per `toolCallId` carrying
`details.agentId` SHALL be retained and SHALL NOT be collapsed away, because the
consumer derives some subagent fields on a FIRST-wins basis from whichever event
creates the map entry. Retention per tool call is therefore at most the creating
update plus the newest update, plus any non-subsumed intermediates.

Collapse SHALL apply at RETENTION only. The event being inserted SHALL always be
stored, so a caller that re-reads it by the returned `seq` (the broadcast path)
observes it unchanged. Collapse SHALL NOT renumber surviving events; `getEvents`
filters by seq and already tolerates seq gaps.

Collapse SHALL NOT remove the highest-seq event in the buffer, so `getMaxSeq`
never regresses.

The retained-update index SHALL be keyed by sequence number, NEVER by array
position, because the per-session trim rebuilds the event array wholesale and
`tool_execution_update` is not an essential chat event. Removal SHALL be
performed only after VERIFYING that the located entry still exists, is a
`tool_execution_update`, and carries the same `toolCallId`; a failed lookup SHALL
be a no-op. A negative or unresolved index SHALL NEVER be passed to an array
removal.

The index SHALL track the pinned creating sequence and the current newest
sequence as INDEPENDENT values per `toolCallId`. A single sequence per
`toolCallId` is insufficient: when the creating update is also the current
newest, a subsuming successor would otherwise be free to collapse the very event
the creating-tick rule pins.

Collapse SHALL be understood as conditional on events retaining a `toolCallId`.
An event reduced to the bounded truncation placeholder carries no `toolCallId`
and SHALL therefore be retained unconditionally, yielding no collapse for that
event.

#### Scenario: Successive subsuming updates for one tool call retain only the newest

- **GIVEN** a session buffer containing `tool_execution_start` for `toolCallId`
  "t1" followed by `tool_execution_update` events for "t1" at seq 2, 3 and 4,
  each carrying the same detail keys
- **WHEN** a further subsuming `tool_execution_update` for "t1" is inserted at
  seq 5
- **THEN** the buffer SHALL contain exactly ONE `tool_execution_update` for "t1"
- **AND** it SHALL be the seq-5 event
- **AND** the `tool_execution_start` at seq 1 SHALL still be present

#### Scenario: A non-subsuming tick retains both events

- **GIVEN** a retained `tool_execution_update` for "t1" whose details carry
  `agentSessionId`
- **WHEN** a later `tool_execution_update` for "t1" arrives WITHOUT
  `agentSessionId`
- **THEN** BOTH updates SHALL be retained
- **AND** a subsequent update that carries `agentSessionId` again SHALL subsume
  only the update it is compared against, never a non-subsumed earlier one

#### Scenario: An empty `entries` tick does not evict a populated timeline

- **GIVEN** a retained `tool_execution_update` for "t1" whose
  `details.entries` is a non-empty array
- **WHEN** a later `tool_execution_update` for "t1" arrives with
  `details.entries` as an EMPTY array
- **THEN** BOTH updates SHALL be retained

#### Scenario: Updates for different tool calls do not collapse each other

- **GIVEN** interleaved `tool_execution_update` events for `toolCallId` "t1" and
  "t2"
- **WHEN** all of them are inserted
- **THEN** the buffer SHALL retain the newest update for "t1" AND the newest
  update for "t2"

#### Scenario: Replaying the collapsed buffer yields the same client state

- **GIVEN** a sequence of `tool_execution_update` events for one `toolCallId`
  that INCLUDES non-subsuming ticks — one omitting `agentSessionId`, one whose
  `details.entries` is empty, one carrying no extractable
  `partialResult.content`, and one whose `partialResult` is a plain string
  followed by a structured update that sets no rendered result
- **AND** the folded subsequence contains NO `tool_execution_end` carrying
  `result` or `details`, because such an event overwrites both fields and would
  satisfy the assertion independently of the collapsed updates
- **WHEN** the full uncollapsed sequence is folded by the client event reducer,
  and separately the collapsed buffer is folded by the same reducer
- **THEN** the resulting message `result`, message `toolDetails`, and `subagents`
  map entries SHALL be equivalent
- **AND** the subagent entry's `type` and `description` SHALL be equal by VALUE,
  not merely present
- **AND** the `subagents` map SHALL still be reachable under BOTH the agent id
  and the `agentSessionId` key
- **AND** this scenario SHALL fail if the subsumption gate or the creating-tick
  retention is removed — a fixture of uniform full snapshots does NOT satisfy
  this scenario

#### Scenario: The entry-creating update is never collapsed away

- **GIVEN** the first `tool_execution_update` for "t1" carrying `details.agentId`
  with a given `subagentType` and `description`
- **WHEN** many later subsuming updates for "t1" are inserted, including some
  carrying a different `subagentType`
- **THEN** the creating update SHALL still be present in the buffer
- **AND** the folded subagent entry's `type` and `description` SHALL match the
  creating update's values

#### Scenario: Update without a toolCallId is retained

- **WHEN** a `tool_execution_update` carrying no `data.toolCallId` is inserted
- **THEN** the store SHALL retain it and SHALL NOT drop any other event on its
  behalf

#### Scenario: A trim that removed the retained update does not corrupt a later collapse

- **GIVEN** a retained `tool_execution_update` for "t1" that the per-session trim
  subsequently drops (updates are non-essential and the trim rebuilds the array)
- **WHEN** a later `tool_execution_update` for "t1" is inserted
- **THEN** the stale index entry SHALL resolve to nothing and the insert SHALL
  proceed as a no-op collapse
- **AND** no other event SHALL be removed — in particular the buffer's highest-seq
  event SHALL still be present and `getMaxSeq(sessionId)` SHALL be unchanged by
  the collapse step

#### Scenario: The newest event in the buffer is never collapsed away

- **GIVEN** a buffer whose highest-seq event is a `tool_execution_update`
- **WHEN** collapse runs
- **THEN** `getMaxSeq(sessionId)` SHALL return that event's seq, unchanged

#### Scenario: Inserted event is readable by its returned seq

- **WHEN** `insertEvent` returns `seq` for a `tool_execution_update` that
  superseded an earlier one
- **THEN** `getEvent(sessionId, seq)` SHALL return that event, so the broadcast
  path re-reads it successfully

#### Scenario: Collapse does not scan the whole buffer per insert

- **GIVEN** a session buffer already holding a large tail of NON-update events
- **WHEN** many subsuming `tool_execution_update` events are inserted,
  INTERLEAVED across many distinct `toolCallId`s so the buffer length stays large
- **THEN** the buffer SHALL hold at most the creating and newest update per
  `toolCallId` at every observable point
- **AND** the total collapse work SHALL NOT be proportional to
  `events × buffer length`
- **AND** the lookup SHALL NOT be a forward linear scan from the head of the
  buffer — a single-`toolCallId` fixture keeps the buffer short and CANNOT
  detect this, so it does not satisfy this scenario

#### Scenario: A pinned creating update is not collapsed when it is also the newest

- **GIVEN** a `toolCallId` whose only retained update is the entry-creating one
- **WHEN** a subsuming `tool_execution_update` for that `toolCallId` is inserted
- **THEN** the creating update SHALL still be retained
- **AND** the newly inserted update SHALL also be retained

#### Scenario: The collapse index does not outlive its session buffer

- **GIVEN** sessions whose buffers are removed by LRU eviction and by
  `deleteEventsForSession`
- **WHEN** many such sessions are cycled through the store
- **THEN** the per-session collapse index SHALL be released with each buffer, so
  it SHALL NOT retain an entry per `toolCallId` of every evicted session
- **AND** a session re-ingested after eviction SHALL NOT act on any index entry
  left over from its previous residency

#### Scenario: Non-update event types are unaffected

- **GIVEN** a buffer containing `message_start`, `message_end`,
  `tool_execution_start` and `tool_execution_end` events
- **WHEN** collapse runs
- **THEN** none of those events SHALL be dropped by the collapse policy

#### Scenario: The essential chat head still survives with collapse enabled

- **GIVEN** a session whose first stored events are `message_start` and
  `message_end`
- **WHEN** a subagent flood of `tool_execution_update` events is inserted with
  collapse enabled and the buffer is driven past the per-session cap
- **THEN** the essential head SHALL still be present and the buffer length SHALL
  still be bounded by `cap + TRIM_SLACK`

### Requirement: Collapse instrumentation

The in-memory event store SHALL make the collapse path observable. `getTrimStats()`
SHALL expose a cumulative process-lifetime count of `tool_execution_update`
events dropped by collapse, alongside the existing trim and eviction counters.
The counter SHALL NOT reset on read.

`getTrimStats()` is serialized onto the `/api/health` response as `storeTrim`.
The new counter SHALL be an ADDITIVE field: no existing field of that payload
changes name, type, or meaning.

The health route's declaration of the store-stats shape SHALL be DERIVED from the
store's exported stats type rather than restated inline, so the route cannot
typecheck against a stale shape when the stats payload gains a field.

#### Scenario: Collapsed updates are counted

- **WHEN** N superseded `tool_execution_update` events are dropped by collapse
- **THEN** `getTrimStats()` SHALL report a cumulative collapsed count of N

#### Scenario: Non-subsuming ticks are not counted as collapsed

- **WHEN** an update is retained because it does not subsume its predecessor
- **THEN** the collapsed count SHALL NOT increment

#### Scenario: Counter is independent of trim and eviction counters

- **WHEN** collapse drops an update AND a per-session trim drops a different
  event
- **THEN** the collapsed count and the trimmed count SHALL each reflect only
  their own policy

#### Scenario: The health payload carries the new counter additively

- **WHEN** `/api/health` is requested
- **THEN** `storeTrim` SHALL include the collapsed counter
- **AND** every previously present `storeTrim` field SHALL still be present with
  its original name and type

### Requirement: A collapsed buffer yields a transmissible catch-up replay frame

The catch-up `event_replay` frame built from a collapsed session buffer SHALL
serialize below `MAX_WS_BUFFER` for a buffer whose superseded
`tool_execution_update` events have been collapsed.

Collapse reduces the buffer that the reconnect catch-up path reads
(`clearReplaying` → `getEvents(sessionId, lastReplayedSeq + 1)` → a single
`event_replay` frame). That reduction is a CONSEQUENCE of the retention policy,
not a transport mechanism, and this requirement exists so the consequence is
asserted rather than assumed — an unasserted side effect regresses silently.

This requirement does NOT introduce a byte budget on the transport. Bounding the
frame by construction (chunking the catch-up tail, measuring serialized frame
bytes at send) is a separate transport change; see design D9.

#### Scenario: The catch-up frame for a collapsed buffer fits the socket budget

- **WHEN** a session buffer has received many superseded `tool_execution_update`
  events across a small number of `toolCallId`s
- **AND** a subscriber reconnects such that the catch-up tail is built from that
  buffer
- **THEN** the serialized `event_replay` frame SHALL be smaller than
  `MAX_WS_BUFFER`

#### Scenario: The same fixture exceeds the budget without collapse

- **WHEN** the identical event sequence is retained with collapse disabled
- **THEN** the serialized catch-up frame SHALL exceed `MAX_WS_BUFFER`
- **AND** this scenario SHALL fail if collapse is made a no-op — a frame-size
  assertion that passes in both configurations proves nothing

#### Scenario: Collapse does not alter which events the catch-up tail selects

- **WHEN** the catch-up tail is built after collapse
- **THEN** it SHALL contain every event with `seq > lastReplayedSeq` that the
  buffer still retains
- **AND** the newest update per `toolCallId` SHALL be among them

