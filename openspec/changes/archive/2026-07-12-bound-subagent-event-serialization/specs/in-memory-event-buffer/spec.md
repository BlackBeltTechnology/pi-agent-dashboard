## ADDED Requirements

### Requirement: Per-event total-serialized-size ceiling
The in-memory event store SHALL bound the total serialized size of every
individual event's `data` to `MAX_EVENT_DATA_SIZE` (default 20000 bytes,
constructor-injectable, `0` = disabled). After the existing per-string-field
truncation runs, the store SHALL estimate the serialized size of `event.data`;
if it still exceeds the ceiling, the store SHALL replace `event.data` with a
bounded placeholder that preserves `eventType` and records the truncation. The
size estimation SHALL be bounded-cost and SHALL NOT serialize the entire object
to measure it (an early-exit walk that stops once the running total crosses the
ceiling). The ceiling SHALL be enforced at ingest (inside the truncator) so that
both persistence (`insertEvent`) and broadcast (`broadcastEvent`) operate on the
already-bounded event.

#### Scenario: Oversized subagent event is bounded before storage
- **GIVEN** an event whose `data` embeds a subagent's full timeline and exceeds
  `MAX_EVENT_DATA_SIZE` after per-field truncation
- **WHEN** the event is inserted
- **THEN** the stored event's `data` SHALL be replaced with a bounded placeholder
  (e.g. `{ __truncated: true, reason, approxBytes, eventType }`) and the stored
  event's serialized size SHALL be ≤ `MAX_EVENT_DATA_SIZE` plus a small constant

#### Scenario: Broadcast of an oversized event serializes a bounded message
- **GIVEN** an over-ceiling event arriving via `event_forward`
- **WHEN** the server broadcasts it to subscribers
- **THEN** the serialized broadcast message SHALL be bounded (built from the
  truncated stored event) and SHALL NOT trigger an unbounded `JSON.stringify`

#### Scenario: Size estimation does not itself allocate an unbounded string
- **GIVEN** an event `data` of arbitrarily large aggregate size
- **WHEN** the store measures whether it exceeds the ceiling
- **THEN** the measurement SHALL stop as soon as the running total crosses the
  ceiling and SHALL NOT materialize a full serialization of the object

#### Scenario: Under-ceiling events are stored unchanged
- **GIVEN** an event whose `data` is within `MAX_EVENT_DATA_SIZE` after per-field
  truncation
- **WHEN** the event is inserted
- **THEN** the event SHALL be stored without the size-ceiling placeholder

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
