## MODIFIED Requirements

### Requirement: Per-event total-serialized-size ceiling
The in-memory event store SHALL bound the total serialized size of every
individual event's `data` to `MAX_EVENT_DATA_SIZE` (default
`DEFAULT_MAX_EVENT_DATA_SIZE` = 262 144 bytes / 256 KiB, constructor-injectable —
smaller values such as 20 000 appear only in tests, `0` = disabled). If an event's `data` exceeds the
ceiling, the store SHALL bound the event as follows:

- **Subagent-timeline events** — an event is a subagent-timeline event ONLY when
  it is TYPE-scoped as one (`data.toolName === "Agent"`, an event type of
  `tool_execution_update`/`tool_execution_end` carrying a `details.agentId`, or an
  event type starting with `subagent_`) AND an `entries[]` array is reachable at
  `data.partialResult.details.entries` or `data.details.entries`. A bare array at
  those paths on an unrelated event SHALL NOT qualify. When such an event's
  `details.entryCount` is a safe integer `>= 0` (the producer streams its steps as separate
  `subagent_entry` events) AND the session's resident events include a
  `subagent_entry` for that agent at EVERY index `0..entryCount-1`, the store
  SHALL replace that `entries[]` with an empty
  array, keep `entryCount`, and then apply the generic path to the rest of the
  event; the timeline is rebuilt from the stored step events, so no head+tail
  reduction and no `steps hidden` sentinel SHALL be produced. Otherwise (a producer
  without step events, or any step no longer resident) the event SHALL be bounded by the generic path like any
  other event. The elision SHALL return a NEW event object with the touched paths
  cloned and SHALL NOT mutate the in-flight `event`.
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

#### Scenario: Non-subagent oversized event is bounded by placeholder
- **GIVEN** an over-ceiling event whose `data` does NOT carry a subagent
  `entries[]` timeline
- **WHEN** the event is inserted
- **THEN** the stored event's `data` SHALL be replaced with a bounded placeholder
  (e.g. `{ __truncated: true, reason, approxBytes, eventType }`) and the stored
  event's serialized size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus a small constant

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

#### Scenario: Oversized streamed subagent frame elides its entries
- **GIVEN** an over-ceiling `subagent_completed` whose `details.entries` holds 300
  entries and whose `details.entryCount` is 300
- **WHEN** the event is inserted
- **THEN** the stored `details.entries` SHALL be `[]`, `details.entryCount` SHALL
  be 300, the stored size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus a small constant,
  and no entry with text `⋯ N steps hidden ⋯` SHALL exist

#### Scenario: Oversized legacy subagent frame takes the generic path
- **GIVEN** an over-ceiling subagent event with more than 20 `entries` and no
  `entryCount`
- **WHEN** the event is inserted
- **THEN** it SHALL be bounded by the generic path and no `steps hidden` sentinel
  SHALL be produced

#### Scenario: Oversized subagent event is bounded before storage
- **GIVEN** an event whose `data` embeds a subagent's full timeline and exceeds
  `MAX_EVENT_DATA_SIZE`
- **WHEN** the event is inserted
- **THEN** the stored event's serialized size SHALL be ≤ `MAX_EVENT_DATA_SIZE`
  plus a small constant — achieved by entries elision (streamed producer) or the
  generic path (legacy producer)

#### Scenario: Oversized subagent event keeps first and last entries
- **GIVEN** an over-ceiling subagent event of a streamed producer (`entryCount` present)
- **WHEN** the event is inserted
- **THEN** the stored `entries[]` SHALL be empty with `entryCount` kept — first and
  last entries are NOT kept in the frame because every step is stored as its own
  `subagent_entry` event

#### Scenario: Large non-entries string does not starve the timeline
- **GIVEN** an over-ceiling streamed subagent event with a large `data.args.prompt`
- **WHEN** the event is inserted
- **THEN** the prompt SHALL be capped by the generic per-string-field rule and the
  timeline SHALL remain fully available from the stored step events

#### Scenario: Shape-only match does not trigger reduction (no false positive)
- **GIVEN** an over-ceiling event that is NOT a subagent event (no
  `toolName === "Agent"`, no `details.agentId`, type not `subagent_*`) but carries an
  array at `data.details.entries` and a numeric `entryCount`
- **WHEN** the event is inserted
- **THEN** the store SHALL NOT elide that array and SHALL bound the event via the
  generic path

#### Scenario: Base64 image does not OOM the reduction or broadcast
- **GIVEN** an over-ceiling subagent event carrying a multi-megabyte base64 image
  inside `data.partialResult.content[*]` or inside an entry
- **WHEN** the event is inserted
- **THEN** the store SHALL NOT materialize a full `JSON.stringify` of the payload,
  and the stored event's actual serialized byte size SHALL be ≤
  `MAX_EVENT_DATA_SIZE` plus a small constant

#### Scenario: Unreducible subagent event falls back to the placeholder
- **GIVEN** an over-ceiling subagent event whose envelope remains over the ceiling
  after entries elision and generic capping
- **WHEN** the event is inserted
- **THEN** the store SHALL replace `data` with the bounded `{ __truncated }`
  placeholder

#### Scenario: Reduction does not mutate the in-flight event
- **GIVEN** an over-ceiling streamed subagent event whose `data` object is also
  referenced by another observer (bridge / logger)
- **WHEN** the store elides its entries at ingest
- **THEN** the store SHALL return a NEW event object and the caller's original
  `event.data.details.entries` SHALL be unchanged

#### Scenario: Timeline array longer than the array-length limit is not clobbered
- **GIVEN** a streamed subagent event whose `entries[]` has more than 20 entries
- **WHEN** the event is truncated at ingest
- **THEN** `entries[]` SHALL be elided to `[]` with `entryCount` kept, and SHALL NOT
  be replaced with the string `"[array truncated]"`

#### Scenario: An entry whose input is a many-leaf object stays within its per-ENTRY budget
- **GIVEN** a stored `subagent_entry` whose `entry.input` is an object with many
  large string leaves
- **WHEN** the event is inserted
- **THEN** each string leaf SHALL be bounded by the generic per-string-field cap and
  the event by the per-event ceiling

#### Scenario: Pathological single huge final entry still bounded
- **GIVEN** a single `subagent_entry` whose entry alone exceeds the ceiling after
  per-field capping
- **WHEN** the event is inserted
- **THEN** the store SHALL fall back to the bounded `{ __truncated }` placeholder
  and the stored size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus a small constant

#### Scenario: Byte-accurate bound holds for escape/multi-byte-heavy input
- **GIVEN** an over-ceiling event whose strings are dominated by characters that
  expand under JSON serialization or UTF-8 multi-byte characters
- **WHEN** the event is inserted
- **THEN** the stored event's ACTUAL serialized byte size SHALL be
  ≤ `MAX_EVENT_DATA_SIZE` plus a small constant

#### Scenario: A missing resident step blocks elision
- **GIVEN** an over-ceiling `subagent_completed` with `entryCount` 300 while the
  store holds `subagent_entry` rows for indices 0..298 only (one trimmed)
- **WHEN** the event is inserted
- **THEN** the store SHALL NOT replace `entries` with `[]` and SHALL bound the event
  via the generic path

#### Scenario: Invalid entryCount never authorizes elision
- **GIVEN** an over-ceiling subagent event whose `details.entryCount` is negative,
  fractional, `NaN`, or larger than the number of resident events
- **WHEN** the event is inserted
- **THEN** the store SHALL NOT elide `entries` and SHALL bound the event via the
  generic path
