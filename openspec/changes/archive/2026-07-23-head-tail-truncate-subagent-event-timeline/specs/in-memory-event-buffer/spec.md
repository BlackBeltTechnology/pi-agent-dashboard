## MODIFIED Requirements

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
