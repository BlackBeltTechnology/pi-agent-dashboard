## MODIFIED Requirements

### Requirement: Replay stream drops superseded streaming updates

During subscribe replay the server SHALL apply a pure compaction pass before batching.
It SHALL preserve the existing finalized-message supersession policy, including thinking and pre-tool text-flush exemptions, and additionally collapse adjacent eligible text snapshots as specified below.
All other event types SHALL pass through untouched.

Compaction is replay-only: the in-memory event store SHALL retain the full event stream, so live broadcast, on-demand tool-output fetch, and status extraction are unaffected.

#### Scenario: Finalized message loses its intermediate updates
- **WHEN** the replay window contains `message_start`, 500 eligible text `message_update` events for assistant message M, and `message_end` for M, without an intervening tool start
- **THEN** the compacted window SHALL contain `message_start` and `message_end` for M
- **AND** the compacted window SHALL NOT contain any of those intermediate updates

#### Scenario: Non-message events pass through
- **WHEN** the replay window contains `tool_execution_start`, `tool_execution_end`, `turn_start`, `turn_end`, `stats_update`, and `session_compact` events
- **THEN** every one of those events SHALL be present in the compacted window, in the original order

#### Scenario: Compaction is idempotent
- **WHEN** the compaction pass is applied to an already-compacted window
- **THEN** the output SHALL equal the input

#### Scenario: Thinking and tool-flush exemptions survive
- **WHEN** a finalized message includes thinking updates and a text snapshot whose text a later tool start flushes into a row
- **THEN** those exempt updates SHALL remain available to reproduce thinking timestamps and the pre-tool text row

### Requirement: Still-streaming tail is preserved

An unfinished message's text and thinking state SHALL remain reconstructible during replay.
Adjacent eligible full text snapshots SHALL retain their last update rather than every intermediate update.
Ineligible updates and events separating runs SHALL retain their existing behavior.

#### Scenario: Mid-turn subscribe keeps the tail
- **WHEN** the replay window ends with `message_start` for message M followed by 12 adjacent eligible text snapshots and NO `message_end` for M
- **THEN** only the last of those 12 updates SHALL remain
- **AND** reducing the replay SHALL produce the same unfinished text as reducing all 12 updates

#### Scenario: Finalized message and streaming tail in one window
- **WHEN** the window holds a completed message M1 followed by a streaming message M2 with adjacent eligible text snapshots and no end
- **THEN** M1's superseded updates SHALL be dropped subject to existing exemptions
- **AND** M2 SHALL retain the final snapshot of each adjacent eligible run and all intervening boundaries

### Requirement: Compaction preserves sequence numbers and replay ordering

Compaction SHALL NOT renumber events: every surviving event SHALL keep its original `seq`, and surviving events SHALL keep their original relative order.
Dropped events leave seq gaps, which are valid.

`sendEventBatches` SHALL report the PRE-compaction highest seq of the window as the replay high-water mark, so suppression catch-up (`clearReplaying`) and the client `lastSeq` contract never re-send or skip events because of compaction.

#### Scenario: Seq values survive compaction
- **WHEN** events with seqs 1..100 are compacted and events 3..98 are non-exempt text `message_update` events for a finalized message
- **THEN** the compacted window SHALL be seqs `[1, 2, 99, 100]`
- **AND** no surviving event's `seq` SHALL differ from its stored value

#### Scenario: High-water mark is the pre-compaction max
- **WHEN** the last event of the window (seq 100) is a `message_update` that compaction drops
- **THEN** `sendEventBatches` SHALL return `100`
- **AND** `clearReplaying` SHALL be called with `100`

### Requirement: Compacted replay yields an equivalent client SessionState

Reducing the compacted window SHALL produce a `SessionState` deep-equal to reducing the raw window for messages finalized within that window.
Thinking updates SHALL be dropped only when this equivalence holds and SHALL otherwise be preserved.
The additional unfinished-tail collapse SHALL preserve the state produced by the existing finalized-message-only replay projection at each tail run's end, at intervening tail events, and after live continuation.

#### Scenario: Plain assistant message equivalence
- **WHEN** a stream of `message_start` + N text-delta `message_update` + `message_end` is reduced raw and compacted
- **THEN** the two resulting `SessionState` values SHALL be deep-equal

#### Scenario: Interleaved text/tool message equivalence
- **WHEN** the message has `[text, toolCall, text]` shape (the `streamingTextFlushed` reorder path)
- **THEN** the raw and compacted `SessionState` values SHALL be deep-equal

#### Scenario: Thinking-bearing message equivalence decides the thinking policy
- **WHEN** the message carries `thinking_start` / `thinking_delta` / `thinking_end` deltas on `message_update` and inline `thinking` blocks on its `message_end`
- **THEN** raw and compacted states SHALL be deep-equal, including thinking content, order, timestamps, duration, and `streamedLive` flags

#### Scenario: Unfinished message remains equivalent before and after live continuation
- **WHEN** a coherent unfinished assistant stream is compacted, then receives another live text update and its eventual `message_end`
- **THEN** raw and compacted states SHALL be deep-equal before continuation, after the live update, and after the end

#### Scenario: Earlier state and text-flush state remain equivalent
- **WHEN** the new tail collapse is applied from a state containing existing messages and tools, or with `streamingTextFlushed` already true
- **THEN** the complete state SHALL equal the reference replay with only the existing finalized-message compaction applied

#### Scenario: Finalized prefixes and backfill retain their established projection
- **WHEN** an earlier finalized prefix contains retained thinking events, or a backfill slice receives an external supersession boundary
- **THEN** the new rule SHALL leave that prefix's or superseded slice's existing replay projection unchanged
- **AND** intermediate equivalence for the new rule SHALL be checked only within its non-superseded tail

### Requirement: Compaction accepts an explicit supersession boundary

`compactEventsForReplay` SHALL accept an optional supersession boundary supplied by the caller.
When supplied, it SHALL replace the derived last-`message_end` boundary and remain relative to the original input array.
When omitted, the existing finalized-message policy SHALL remain unchanged except for the additional adjacent-run collapse.
Both modes SHALL preserve thinking and pre-tool-flush exemptions.

#### Scenario: Omitted boundary preserves existing behavior
- **WHEN** compaction is invoked without an explicit boundary
- **THEN** finalized-message supersession SHALL use the existing derived boundary
- **AND** the only additional removals SHALL be superseded snapshots within eligible adjacent runs

#### Scenario: Supplied boundary supersedes the whole slice
- **WHEN** compaction is invoked on a middle slice with a boundary indicating a later `message_end` exists outside the slice
- **THEN** every non-exempt `message_update` in the slice SHALL be dropped

#### Scenario: Exemptions hold under a supplied boundary
- **WHEN** compaction receives an external boundary and a slice containing a thinking update and a text-bearing update immediately preceding `tool_execution_start`
- **THEN** both exempt updates SHALL remain

#### Scenario: Filtering does not shift the caller's boundary
- **WHEN** eligible runs occur on both sides of an explicit boundary within the original input array
- **THEN** supersession SHALL use those original positions, not positions in a shortened array

## ADDED Requirements

### Requirement: Adjacent full text snapshots collapse without crossing event boundaries

The new rule SHALL collapse only adjacent full assistant text snapshots in the non-superseded tail.
Content SHALL be a string or text-block array with string text.
`assistantMessageEvent` SHALL be absent or a non-null object with type `text_start`, `text_delta`, or `text_end`.
Other events and unsupported content or metadata SHALL break a run.
The final snapshot SHALL survive; earlier positions SHALL remain governed solely by existing finalized-message compaction.

#### Scenario: Zero, one, and two snapshots
- **WHEN** a replay contains zero, one, or two adjacent eligible unfinished snapshots
- **THEN** the corresponding snapshot counts SHALL be zero, one, and one
- **AND** the surviving update SHALL be the original final event object with its original sequence number

#### Scenario: Empty and shorter replacements are valid snapshots
- **WHEN** adjacent eligible snapshots contain `abcdef`, then `ab`, then empty text
- **THEN** the final empty snapshot SHALL survive
- **AND** the reconstructed streaming text SHALL be empty

#### Scenario: Content forms and assistant metadata are classified explicitly
- **WHEN** snapshots use string content, empty arrays, or arrays of text blocks, with absent metadata or each supported text metadata type
- **THEN** they SHALL be eligible
- **AND** delta-only events without a full assistant snapshot, malformed metadata, mixed text/thinking/tool/image content, and non-assistant messages SHALL be ineligible for this new rule

#### Scenario: Boundaries prevent accidental new adjacency
- **WHEN** two eligible tail snapshots are separated in the original stream by thinking, tool lifecycle, message lifecycle, custom/plugin, or another ineligible event
- **THEN** the new collapse rule SHALL NOT merge them across that event
- **AND** that tail separator SHALL remain in the replay

#### Scenario: Superseded prefix filtering does not introduce tail runs
- **WHEN** an explicit boundary separates a superseded prefix from an unfinished tail
- **THEN** the new rule SHALL make no additional removals within the prefix
- **AND** only originally adjacent eligible snapshots at or after the boundary SHALL collapse

### Requirement: Snapshot reduction leaves stored data untouched and removes repeated payload

Replay compaction SHALL leave input arrays and event objects unchanged.
For an unfinished run of 100 eligible snapshots containing 1 through 100 KiB of text, replay SHALL retain one update with the final payload and SHALL serialize to fewer bytes than the raw run.
Sequence gaps SHALL remain valid and replay cursors SHALL continue to use the pre-compaction high-water mark.

#### Scenario: Deterministic repeated-payload reduction
- **WHEN** the 100-snapshot fixture is compacted and serialized using the replay event encoding
- **THEN** its update count SHALL be one and its serialized byte count SHALL be lower than the raw fixture
- **AND** the final update's text and the resulting client state SHALL be unchanged

#### Scenario: Store data and cursor survive replay reduction
- **WHEN** a subscribe replay compacts stored snapshots and then releases suppressed live events
- **THEN** the stored events SHALL remain unchanged
- **AND** the catch-up cursor SHALL use the raw replay window's highest sequence number without duplicating or skipping subsequent live events
