# chat-selection-preservation Specification

## Purpose
TBD - created by archiving change preserve-chat-selection-during-churn. Update Purpose after archive.
## Requirements
### Requirement: Active transcript selection is detected

The chat view SHALL expose a single "user is selecting transcript text" signal
derived from the browser selection. The signal SHALL be true when a non-collapsed
`Selection` intersects the chat scroll container — tested on both the anchor and
the focus endpoint (or via range intersection), NOT anchor containment alone —
and false otherwise. Detection SHALL cover mouse drag, keyboard (Shift+Arrow),
multi-click, and Select-All, via the `selectionchange` event.

#### Scenario: Non-collapsed selection inside the transcript
- **WHEN** the user highlights text whose anchor node is inside the chat scroll container
- **THEN** the active-selection signal SHALL become true

#### Scenario: Selection collapses
- **WHEN** the user clicks elsewhere or the selection otherwise collapses
- **THEN** the active-selection signal SHALL become false

#### Scenario: Selection outside the transcript is ignored
- **WHEN** the user selects text outside the chat scroll container (e.g. the composer input or another pane)
- **THEN** the active-selection signal SHALL remain false

### Requirement: Selection in a finished card survives transcript churn

The chat view SHALL NOT collapse a selection anchored in a finished
(non-streaming) transcript card due to streaming updates, new card arrivals,
auto-scroll, or virtual-window recomputation. Rows the selection intersects
SHALL remain mounted for the lifetime of the selection, even if they drift
outside the normal viewport + overscan band. Retention SHALL be proactive: the
selection's row span SHALL be tracked from selection start (while the anchor row
is mounted) and kept mounted so that no intersected row is ever unmounted — a
reactive path that re-mounts after churn is insufficient, because DOM Range
endpoints are moved synchronously and irreversibly when their row unmounts.

#### Scenario: New card arrives while a finished card is selected
- **WHEN** the user holds a selection in a finished card AND a new message or tool card is appended to the transcript
- **THEN** the existing selection SHALL remain intact and copyable

#### Scenario: Streaming continues while a finished card is selected
- **WHEN** the user holds a selection in a finished card AND the assistant continues streaming into the tail card
- **THEN** the existing selection SHALL remain intact and copyable

#### Scenario: Multi-card selection spanning rows near the window edge
- **WHEN** the user selects text spanning multiple cards AND transcript churn would otherwise unmount one endpoint row
- **THEN** every row the selection intersects SHALL stay mounted and the selection SHALL remain intact

#### Scenario: Very large selection is bounded, not a full mount
- **WHEN** the user performs Select-All (or selects a row span exceeding the retained-row ceiling) on a long transcript
- **THEN** the transcript SHALL NOT force-mount every row
- **AND** past the ceiling the selection MAY collapse on churn (a visible outcome), and the view SHALL NOT mount only the endpoints and hand back a silently truncated copy

### Requirement: Selection in the streaming tail is preserved best-effort

The chat view SHALL preserve a selection anchored inside the actively streaming
tail card across chunk appends and across the streaming→committed transition at
turn completion, via a node-stable streaming render that does not replace the
committed Text nodes under an active selection. Chunks arriving while a tail
selection is held SHALL be buffered and flushed on collapse, without dropping
non-chunk state mutations.

#### Scenario: Selecting inside the streaming card

- **WHEN** the user holds a selection whose anchor is inside the streaming tail card AND new chunks arrive
- **THEN** the committed text nodes under the selection SHALL NOT be replaced until the selection collapses, after which buffered chunks SHALL flush

#### Scenario: Selection survives turn completion

- **WHEN** the user holds a selection inside the streaming tail AND the turn completes (`message_end`)
- **THEN** the selection SHALL remain intact and copyable in the committed card

### Requirement: Copy of a transcript selection is faithful to the selected content

When the user copies an active transcript selection, the clipboard text SHALL
reflect the selected content, including partial-node selections and content that
a renderer caps in the DOM. Fidelity SHALL be provided by intercepting the
container `copy` event and rebuilding clipboard text from the selected region,
not by what happens to be mounted.

#### Scenario: Partial-node selection

- **WHEN** the user copies a selection that starts or ends mid-node inside rendered markdown
- **THEN** the clipboard text SHALL contain exactly the selected characters, extracted from the selected DOM (`Range.cloneContents()`), not the whole message

#### Scenario: Selection over a DOM-capped renderer

- **WHEN** the user copies a selection over a renderer that caps its rendered text (e.g. `AgentToolRenderer` `slice(0, 1000)`) AND that renderer exposes its full text to the copy path
- **THEN** the clipboard text SHALL contain the full selected text, not the DOM-capped prefix

### Requirement: An active selection is anchored against layout shift

While the active-selection signal is true, the chat view SHALL keep the selected
content geometrically stable under the pointer. When a transcript row resizes,
is inserted, or is reordered such that the selection's anchor row would move
relative to the viewport, the view SHALL compensate so that the anchor row's
viewport position is preserved and the text under the pointer remains the text
the pointer addressed before the layout change.

Compensation SHALL be defined by the anchor row's RESIDUAL shift — how far it
still moved once the virtualizer has applied its own correction — and not by
the kind of mutation that caused it. It therefore covers in-viewport resizes,
insertions, and reorders alike, while a shift the virtualizer has already
corrected presents a residual of ~0 and SHALL produce no further adjustment, so
its above-viewport correction is never applied twice. Outside an active
selection, layout and scroll behaviour SHALL be unchanged.

Retention of intersected rows (the existing requirement) guarantees a selection
is not destroyed; this requirement additionally guarantees it is not silently
retargeted onto different content.

#### Scenario: Tool card above the selection completes mid-drag

- **WHEN** the user is drag-selecting text inside one message AND a tool-result card above it in the viewport transitions from running to completed and renders its output body
- **THEN** the selected text SHALL continue to extend in the direction of pointer travel
- **AND** the selection SHALL NOT extend to content above the point where the drag began

#### Scenario: Row above the selection grows on measurement

- **WHEN** a row above the selection anchor is re-measured to a height larger than its estimate (image decode, Mermaid or KaTeX layout, expansion of a collapsed card) while a selection is held
- **THEN** the anchor row's position relative to the viewport SHALL be preserved
- **AND** the selected string SHALL NOT change

#### Scenario: Row above the selection shrinks

- **WHEN** a row above the selection anchor is re-measured to a height smaller than its estimate while a selection is held
- **THEN** the anchor row's position relative to the viewport SHALL be preserved
- **AND** the selection SHALL NOT extend to content below the point where the drag began

#### Scenario: Correction is clamped at a scroll boundary

- **WHEN** the correction required to hold the anchor would move `scrollTop` outside `[0, scrollHeight − clientHeight]` (for example a shrink above the selection while already at the top)
- **THEN** the view SHALL apply as much of the correction as the clamp permits
- **AND** the compensator SHALL re-baseline from the ACTUALLY APPLIED delta, so the un-applied remainder is NOT re-issued on every subsequent commit
- **AND** the anchor-position guarantee holds only to the extent the clamp allows

#### Scenario: Above-viewport correction is not doubled

- **WHEN** a row entirely above the viewport resizes while a selection is held
- **THEN** the resulting scroll adjustment SHALL be applied exactly once
- **AND** the anchor row SHALL NOT jump by twice the resize delta

#### Scenario: No compensation without a selection

- **WHEN** rows resize, are inserted, or are reordered AND no selection is active
- **THEN** scroll position SHALL behave exactly as it does today, including sticky-bottom follow

### Requirement: Selection state is published on a single clock

The active-selection signal SHALL be readable synchronously by every consumer
that gates behaviour on it, whether it runs outside React's render cycle (the
virtualizer `onChange` bottom-pin) or inside it (the sticky-bottom layout
effect). No such consumer SHALL observe a stale `false` after a selection has
begun. A debounced, render-driven copy of the signal MAY additionally exist for
effects that need a re-render and the `→ false` edge, but SHALL NOT be the only
gate on any suspend.

#### Scenario: Chunk arrives on the first frame of a drag

- **WHEN** the user begins a drag-selection AND a streaming chunk arrives before React has committed the resulting render
- **THEN** the sticky-bottom auto-scroll SHALL already be suspended
- **AND** the view SHALL NOT scroll to the bottom

#### Scenario: Follow resumes on collapse

- **WHEN** the selection collapses AND sticky-bottom follow was armed before the selection began
- **THEN** auto-scroll follow SHALL resume without requiring further content to arrive

