## MODIFIED Requirements

### Requirement: Off-screen transcript content costs no layout or paint

The chat transcript SHALL window the message list so that only rows near the viewport (plus an overscan margin and the streaming tail) are **mounted in the DOM**. Rows far outside the viewport MUST NOT be mounted, and therefore MUST NOT contribute to style-recalculation, layout, paint, event-listener count, or retained React fibers. Mounted-node count, listener count, and GC pressure SHALL be bounded by the viewport working set, not by total session length. Two bounded exceptions apply:
- While a transcript selection is held, the working set MAY also include the rows that selection requires: at most the retained-row ceiling within it, otherwise only its endpoint rows.
- While a copy is being served, the selected span MAY be mounted transiently, up to the copy ceiling. It SHALL be unmounted again within the same task, before any paint.

#### Scenario: Layout cost bounded regardless of session length
- **WHEN** a session transcript grows arbitrarily long (hundreds of messages, tens of thousands of would-be DOM nodes)
- **THEN** the number of mounted layout objects SHALL remain bounded by the viewport working set (viewport + overscan + streaming tail), and per-pass layout duration SHALL NOT grow with total session length

#### Scenario: Mounted node and listener count bounded
- **WHEN** the transcript is windowed on a long session
- **THEN** the count of mounted DOM nodes and attached event listeners SHALL be bounded by the viewport working set and SHALL NOT scale with total message count

#### Scenario: Off-screen strips are not repainted
- **WHEN** animations or state changes trigger paints while a long transcript is open
- **THEN** paint records SHALL NOT include rasterization of off-screen transcript rows, because those rows are not mounted

#### Scenario: Large held selection stays bounded
- **WHEN** the user holds a selection spanning far more rows than the retained-row ceiling
- **THEN** the mounted rows SHALL be the viewport working set plus at most the selection's endpoint rows, and SHALL NOT scale with the selection's row span

### Requirement: Virtualization preserves scroll and streaming semantics

Skipping off-screen rendering SHALL NOT change user-visible scrolling behavior: bottom-anchored auto-scroll while following, scroll-lock when the user has scrolled up (per the existing `chat-scroll-lock` capability), jump-to-message, and the imperative `ChatViewHandle` API MUST behave exactly as before. The mounted working set SHALL be the viewport + overscan window PLUS the rows an active transcript selection requires. These are added through the virtualizer's own range (a `rangeExtractor` that unions them into the default range), so they are mounted, positioned, and measured by the virtualizer. The required rows SHALL be every selection-intersecting row while the selected row span is within the retained-row ceiling, and only the two endpoint rows past it. The ceiling SHALL be keyed by primary input modality (coarse vs fine pointer), not by viewport dimensions. While a copy of the selection is served, the full selected span MAY be mounted transiently. Those copy-only rows SHALL NOT be measured, SHALL NOT feed the row-size cache or row-growth anchoring, and SHALL be unmounted again within the same task, before any paint. They SHALL be released even if serializing the copy fails.

#### Scenario: Auto-scroll follow unaffected
- **WHEN** the user is at/near the bottom and new content streams in
- **THEN** the view SHALL auto-scroll to follow, with no visible jumps caused by off-screen size estimation

#### Scenario: Scrolling back through history
- **WHEN** the user scrolls up through older messages
- **THEN** messages SHALL appear rendered and correctly sized as they enter the viewport, without scroll-position jumps or blank flashes lasting beyond one frame

#### Scenario: Streaming tail always rendered
- **WHEN** a message is currently streaming (`streamingText`/`streamingThinking`)
- **THEN** the streaming content SHALL always be fully rendered and never skipped by the off-screen optimization

#### Scenario: Selection-intersecting rows stay mounted
- **WHEN** the user holds an active transcript selection within the retained-row ceiling AND a selection-intersecting row would normally be unmounted (outside viewport + overscan)
- **THEN** that row SHALL remain mounted until the selection collapses
- **AND** the retained rows SHALL be mounted, positioned, and measured by the virtualizer via `rangeExtractor` (not bolt-on rows); `getTotalSize()`/spacer height MAY change as a retained row measures, exactly as it does when the user scrolls a row into view (per design D3 — the "unchanged total size" invariant is not achievable with `measureElement` rows and is not required)

#### Scenario: Only endpoint rows retained past the ceiling
- **WHEN** the user holds a selection whose row span exceeds the retained-row ceiling
- **THEN** the mounted working set SHALL be the viewport + overscan window plus the anchor and focus endpoint rows
- **AND** interior selected rows outside that set SHALL NOT be mounted

#### Scenario: Copy-time span mount is transient and unmeasured
- **WHEN** the user copies a selection whose interior rows are unmounted
- **THEN** the interior rows SHALL be mounted only for the duration of the copy handler and unmounted before the next paint
- **AND** the row-size cache, `getTotalSize()`, `scrollHeight`, and `scrollTop` SHALL be the same after the copy as before it

#### Scenario: Copy-time mount is released when serialization fails
- **WHEN** building the clipboard text throws during a copy
- **THEN** the copy-only rows SHALL still be unmounted and later renders SHALL return to the normal working set
