# chat-transcript-virtualization

## Purpose

Bound the chat transcript's per-frame layout and paint work to the viewport working set plus the streaming tail, so cost does not grow with total session length, while preserving all existing scroll and streaming semantics.
## Requirements
### Requirement: Off-screen transcript content costs no layout or paint

The chat transcript SHALL window the message list so that only rows near the viewport (plus an overscan margin and the streaming tail) are **mounted in the DOM**. Rows far outside the viewport MUST NOT be mounted, and therefore MUST NOT contribute to style-recalculation, layout, paint, event-listener count, or retained React fibers. Mounted-node count, listener count, and GC pressure SHALL be bounded by the viewport working set, not by total session length.

#### Scenario: Layout cost bounded regardless of session length
- **WHEN** a session transcript grows arbitrarily long (hundreds of messages, tens of thousands of would-be DOM nodes)
- **THEN** the number of mounted layout objects SHALL remain bounded by the viewport working set (viewport + overscan + streaming tail), and per-pass layout duration SHALL NOT grow with total session length

#### Scenario: Mounted node and listener count bounded
- **WHEN** the transcript is windowed on a long session
- **THEN** the count of mounted DOM nodes and attached event listeners SHALL be bounded by the viewport working set and SHALL NOT scale with total message count

#### Scenario: Off-screen strips are not repainted
- **WHEN** animations or state changes trigger paints while a long transcript is open
- **THEN** paint records SHALL NOT include rasterization of off-screen transcript rows, because those rows are not mounted

### Requirement: Virtualization preserves scroll and streaming semantics

Windowing off-screen rows SHALL NOT change user-visible scrolling behavior. The existing `chat-scroll-lock` capability (50px lock threshold, scroll-to-bottom button, multi-batch `event_replay` race behavior), the bottom-anchored auto-scroll-while-following, jump-to-message, per-session scroll restore, and the imperative `ChatViewHandle` API (including `scrollToTurn`) MUST behave exactly as before. In addition, the user SHALL be able to scroll up and land on the first transcript row: an upward scroll gesture SHALL converge on index 0 and MUST NOT diverge as off-screen rows mount and re-measure.

#### Scenario: Auto-scroll follow unaffected
- **WHEN** the user is within 50px of the bottom and new content streams in
- **THEN** the view SHALL auto-scroll to follow, with no visible jumps caused by off-screen size estimation

#### Scenario: Scroll lock preserved under windowing
- **WHEN** the user scrolls up more than 50px from the bottom
- **THEN** new and streaming content SHALL NOT pull the view down, AND the scroll-to-bottom button SHALL appear — identical to the `chat-scroll-lock` behavior with a fully-materialized list

#### Scenario: Scrolling up converges on the first row
- **WHEN** the user scrolls up through a transcript that contains rows far larger than their pre-measure estimate (for example a user message with a pasted image, or a multi-thousand-line tool result) positioned near the top
- **THEN** the scroll position SHALL converge on the first row without the top boundary receding faster than the user scrolls, AND the user SHALL be able to bring the first message fully into view

#### Scenario: Above-viewport row mount does not shift the visible anchor
- **WHEN** a row above the current viewport mounts and measures larger than its estimated size while the view is scroll-locked (not following the bottom)
- **THEN** the currently visible content SHALL NOT shift by more than one row height, because `scrollTop` is compensated by the measured-minus-estimated delta

#### Scenario: Scrolling back through history
- **WHEN** the user scrolls up through older messages
- **THEN** rows SHALL mount and be correctly sized as they enter the viewport, without scroll-position jumps or blank flashes lasting beyond one frame

#### Scenario: Jump to an off-screen turn
- **WHEN** `ChatViewHandle.scrollToTurn(turnIndex)` is called for a turn whose rows are currently unmounted (outside the window)
- **THEN** the view SHALL scroll so that turn's first row lands at the top of the viewport (top-aligned), mounting it in the process, AND auto-scroll follow SHALL be suspended until the user returns to the bottom

#### Scenario: Streaming tail always rendered
- **WHEN** a message is currently streaming (`streamingText`/`streamingThinking`) or steering bubbles are pending
- **THEN** the streaming/pending content SHALL always be mounted and rendered, never unmounted by the windowing, and its growth SHALL keep the bottom pinned while the user is following

#### Scenario: Per-session scroll position restored across switches
- **WHEN** the user switches away from a session scrolled to a specific position and later returns
- **THEN** the view SHALL restore that position (bottom-pinned if it was following, else the same anchored row), using virtual coordinates rather than a raw pixel offset

### Requirement: Content-aware pre-measure row-height estimate

The virtualizer's pre-measure size estimate for a transcript row SHALL scale with the row's payload rather than being a constant per row type, so that first-paint estimate error is small for large rows. The estimate SHALL be a pure, O(1) function of already-available row data (text length, presence of an image or inline-terminal block) and MUST NOT re-measure the DOM or walk content blocks on every scroll pass.

#### Scenario: Larger text payload yields a larger estimate
- **WHEN** two rows of the same role differ only in text length
- **THEN** the row with more text SHALL receive a larger pre-measure estimate (monotonic in text length), up to a bounded clamp

#### Scenario: Image-bearing row reserves image height
- **WHEN** a row contains an inline image block
- **THEN** its estimate SHALL include a fixed reserve for the image's capped render height, in addition to its text estimate

#### Scenario: Estimate stays O(1) under windowing
- **WHEN** the virtualizer computes estimates during a scroll
- **THEN** each row's estimate SHALL be derived from precomputed per-row data (text length computed once when the display-row list is built), not by re-walking the row's content blocks per call

### Requirement: Deterministic scroll-to-top affordance

The transcript SHALL provide a scroll-to-top control, symmetric to the scroll-to-bottom control, that lands the view on the first row regardless of residual estimate error.

#### Scenario: Scroll-to-top button appears when scrolled down
- **WHEN** the transcript is scrolled away from the top by more than the scroll threshold
- **THEN** a scroll-to-top control SHALL be visible

#### Scenario: Scroll-to-top lands on the first row
- **WHEN** the user activates the scroll-to-top control
- **THEN** the view SHALL scroll so the first row is top-aligned (index 0, `align:"start"`), mounting it if unmounted, AND auto-scroll-follow SHALL be suspended until the user returns to the bottom

#### Scenario: Scroll-to-top does not fight the bottom-pin
- **WHEN** the scroll-to-top control is activated while content is streaming
- **THEN** the view SHALL move to the top and remain scroll-locked (not be pulled back to the bottom by the streaming bottom-pin) until the user re-arms follow
