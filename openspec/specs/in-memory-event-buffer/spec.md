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
The event store string truncation SHALL preserve base64 image data fields. When truncating object fields, if a key is `"data"` and the parent object contains a `"mimeType"` key, the value SHALL NOT be truncated.

#### Scenario: Image base64 data preserved
- **WHEN** a `message_start` event contains a user message with an image content block `{ type: "image", data: "<200KB base64>", mimeType: "image/png" }`
- **THEN** the event store SHALL store the full `data` string without truncation

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
individual event's `data` to `MAX_EVENT_DATA_SIZE` (default 20000 bytes,
constructor-injectable, `0` = disabled). If an event's `data` exceeds the
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

#### Scenario: Image-bearing NON-subagent event is bounded (byte-accurate detection)
- **GIVEN** a non-subagent event whose `data` embeds a large base64 image such
  that a code-unit estimate would under-count it below the ceiling
- **WHEN** the event is inserted
- **THEN** the byte-accurate walk SHALL count the image at its real size, detect
  the event as over-ceiling, and replace `data` with the `{ __truncated }`
  placeholder — the event SHALL NOT be stored at full size

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

