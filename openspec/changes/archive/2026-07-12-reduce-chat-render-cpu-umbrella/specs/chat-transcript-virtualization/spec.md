## ADDED Requirements

### Requirement: Off-screen transcript content costs no layout or paint

The chat transcript SHALL limit per-frame layout and paint work to messages near the viewport plus the streaming tail. Messages far outside the viewport MUST NOT contribute to style-recalculation, layout, or paint cost (first step: `content-visibility: auto` with a tuned `contain-intrinsic-size` on per-message wrappers; full windowing only if the budget is still missed).

#### Scenario: Layout cost bounded regardless of session length
- **WHEN** a session transcript grows arbitrarily long (hundreds of messages, tens of thousands of DOM nodes)
- **THEN** the number of layout objects processed per layout pass SHALL remain bounded by the viewport working set (not the full transcript), and per-pass layout duration SHALL NOT grow with total session length

#### Scenario: Off-screen strips are not repainted
- **WHEN** animations or state changes trigger paints while a long transcript is open
- **THEN** paint records SHALL NOT include repeated rasterization of tall off-screen transcript regions

### Requirement: Virtualization preserves scroll and streaming semantics

Skipping off-screen rendering SHALL NOT change user-visible scrolling behavior: bottom-anchored auto-scroll while following, scroll-lock when the user has scrolled up (per the existing `chat-scroll-lock` capability), jump-to-message, and the imperative `ChatViewHandle` API MUST behave exactly as before.

#### Scenario: Auto-scroll follow unaffected
- **WHEN** the user is at/near the bottom and new content streams in
- **THEN** the view SHALL auto-scroll to follow, with no visible jumps caused by off-screen size estimation

#### Scenario: Scrolling back through history
- **WHEN** the user scrolls up through older messages
- **THEN** messages SHALL appear rendered and correctly sized as they enter the viewport, without scroll-position jumps or blank flashes lasting beyond one frame

#### Scenario: Streaming tail always rendered
- **WHEN** a message is currently streaming (`streamingText`/`streamingThinking`)
- **THEN** the streaming content SHALL always be fully rendered and never skipped by the off-screen optimization
