## MODIFIED Requirements

### Requirement: Virtualization preserves scroll and streaming semantics

Skipping off-screen rendering SHALL NOT change user-visible scrolling behavior: bottom-anchored auto-scroll while following, scroll-lock when the user has scrolled up (per the existing `chat-scroll-lock` capability), jump-to-message, and the imperative `ChatViewHandle` API MUST behave exactly as before. The mounted working set SHALL be the viewport + overscan window PLUS any rows intersected by an active transcript selection, extended through the virtualizer's own range (a `rangeExtractor` that unions the selection-intersecting indices into the default range) so those rows are mounted, positioned, and measured by the virtualizer. Selection-intersecting rows outside the normal window SHALL stay mounted for the selection's lifetime, subject to a bounded retained-row ceiling.

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
- **WHEN** the user holds an active transcript selection AND a selection-intersecting row would normally be unmounted (outside viewport + overscan)
- **THEN** that row SHALL remain mounted until the selection collapses
- **AND** the total virtual size and spacer height SHALL be unchanged by the retained rows
