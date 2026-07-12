## MODIFIED Requirements

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

Windowing off-screen rows SHALL NOT change user-visible scrolling behavior. The existing `chat-scroll-lock` capability (50px lock threshold, scroll-to-bottom button, multi-batch `event_replay` race behavior), the bottom-anchored auto-scroll-while-following, jump-to-message, per-session scroll restore, and the imperative `ChatViewHandle` API (including `scrollToTurn`) MUST behave exactly as before.

#### Scenario: Auto-scroll follow unaffected
- **WHEN** the user is within 50px of the bottom and new content streams in
- **THEN** the view SHALL auto-scroll to follow, with no visible jumps caused by off-screen size estimation

#### Scenario: Scroll lock preserved under windowing
- **WHEN** the user scrolls up more than 50px from the bottom
- **THEN** new and streaming content SHALL NOT pull the view down, AND the scroll-to-bottom button SHALL appear — identical to the `chat-scroll-lock` behavior with a fully-materialized list

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
