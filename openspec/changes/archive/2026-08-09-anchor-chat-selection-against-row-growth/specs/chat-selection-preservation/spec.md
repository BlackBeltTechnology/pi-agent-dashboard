## ADDED Requirements

### Requirement: An active selection is anchored against layout shift

While the active-selection signal is true, the chat view SHALL keep the selected
content geometrically stable under the pointer. When a transcript row resizes,
is inserted, or is reordered such that the selection's anchor row would move
relative to the viewport, the view SHALL compensate so that the anchor row's
viewport position is preserved and the text under the pointer remains the text
the pointer addressed before the layout change.

Compensation SHALL apply only to shifts that the virtualizer does not already
correct — that is, resizes of rows inside the viewport — so that the
virtualizer's own above-viewport correction is never applied twice. Outside an
active selection, layout and scroll behaviour SHALL be unchanged.

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
