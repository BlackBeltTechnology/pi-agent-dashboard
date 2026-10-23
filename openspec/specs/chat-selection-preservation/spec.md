# chat-selection-preservation Specification

## Purpose
TBD - created by archiving change preserve-chat-selection-during-churn. Update Purpose after archive.

## Requirements

### Requirement: Active transcript selection is detected

The chat view SHALL expose a single "user is selecting transcript text" signal
derived from the browser selection. The signal SHALL be true when a non-collapsed
`Selection` has its anchor OR its focus endpoint inside the chat scroll container
(NOT anchor containment alone), and false otherwise. Detection SHALL cover mouse
drag, keyboard (Shift+Arrow), multi-click, and a Select-All that leaves an
endpoint inside the transcript, via the `selectionchange` event. A range whose
anchor and focus BOTH lie outside the transcript (e.g. page-wide Select-All) is
NOT an active transcript selection. Its copy is still governed by the copy
requirement below.

#### Scenario: Non-collapsed selection inside the transcript
- **WHEN** the user highlights text whose anchor node is inside the chat scroll container
- **THEN** the active-selection signal SHALL become true

#### Scenario: Selection collapses
- **WHEN** the user clicks elsewhere or the selection otherwise collapses
- **THEN** the active-selection signal SHALL become false

#### Scenario: Selection outside the transcript is ignored
- **WHEN** the user selects text outside the chat scroll container (e.g. the composer input or another pane)
- **THEN** the active-selection signal SHALL remain false

#### Scenario: Page-wide Select-All is not an active transcript selection
- **WHEN** the user performs Select-All with focus outside any editable field, so both endpoints lie outside the transcript
- **THEN** the active-selection signal SHALL remain false and no transcript row SHALL be retained for it

### Requirement: Selection in a finished card survives transcript churn

The chat view SHALL NOT collapse, clear, or re-anchor a selection anchored in a
finished (non-streaming) transcript card because of streaming updates, new card
arrivals, auto-scroll, virtual-window recomputation, or the size of the
selection. Retention SHALL be proactive: the rows holding the selection's
endpoints SHALL stay mounted for the lifetime of the selection, even if they
drift outside the normal viewport + overscan band. When the selected row span is
within the retained-row ceiling, every intersected row SHALL also stay mounted.
Past that ceiling, interior rows MAY unmount, but the endpoint rows SHALL NOT,
and the view SHALL NOT clear the selection. A selection past the ceiling is an
active selection for its whole lifetime, exactly as a smaller one is.

Retention SHALL NOT depend on when the browser delivers `selectionchange`. Each
time the mounted window is recomputed, the endpoint rows SHALL also be resolved
from the live selection. That live resolution SHALL identify rows by stable row
identity, never by a positional index that a history splice can renumber. A
reactive path that re-mounts after churn is insufficient: DOM Range endpoints
move synchronously and irreversibly when their row unmounts.

The retained-row ceiling SHALL depend on the primary input modality: a lower
ceiling for a coarse pointer (touch), a higher one for a fine pointer. It SHALL
NOT depend on viewport dimensions.

#### Scenario: New card arrives while a finished card is selected
- **WHEN** the user holds a selection in a finished card AND a new message or tool card is appended to the transcript
- **THEN** the existing selection SHALL remain intact and copyable

#### Scenario: Streaming continues while a finished card is selected
- **WHEN** the user holds a selection in a finished card AND the assistant continues streaming into the tail card
- **THEN** the existing selection SHALL remain intact and copyable

#### Scenario: Multi-card selection spanning rows near the window edge
- **WHEN** the user selects text spanning multiple cards AND transcript churn would otherwise unmount one endpoint row
- **THEN** every row the selection intersects SHALL stay mounted and the selection SHALL remain intact

#### Scenario: Drag past the retained-row ceiling keeps the selection
- **WHEN** the user drag-selects (mouse or touch, with auto-scroll or wheel scrolling) across more rows than the retained-row ceiling
- **THEN** the selection SHALL remain non-collapsed with its original anchor in every supported engine (Chromium, Gecko, WebKit)
- **AND** the view SHALL NOT clear the selection programmatically
- **AND** the rows holding the anchor and focus endpoints SHALL stay mounted while interior rows MAY unmount

#### Scenario: Very large selection is bounded, not a full mount
- **WHEN** the user selects a row span exceeding the retained-row ceiling on a long transcript
- **THEN** the transcript SHALL NOT keep every selected row mounted while the selection is held
- **AND** the selection SHALL remain intact

#### Scenario: Streaming continues while a past-ceiling selection is held
- **WHEN** the user holds a selection wider than the retained-row ceiling AND new chunks or cards arrive
- **THEN** the view SHALL NOT scroll to the bottom on its own while the selection is held
- **AND** no arriving content SHALL be lost; it SHALL be visible after the selection collapses

#### Scenario: Late selectionchange does not lose the anchor
- **WHEN** the virtual window is recomputed (scroll or churn) after the selection was extended but before the browser has delivered the corresponding `selectionchange`
- **THEN** the anchor row SHALL stay mounted and the selection SHALL NOT be re-targeted to the transcript container or to another row

#### Scenario: History splice during an active selection
- **WHEN** a history backfill splices rows above the selection while the selection is held
- **THEN** the rows retained for the selection SHALL be the rows that hold its endpoints after the splice, not the rows that now occupy their previous indices

#### Scenario: Short desktop window uses the fine-pointer ceiling
- **WHEN** the dashboard runs in a desktop browser with a fine pointer in a window shorter than the mobile height breakpoint
- **THEN** the fine-pointer retained-row ceiling SHALL apply

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

When the user copies a selection that intersects the transcript, the clipboard
text SHALL reflect the selected content, including:
- partial-node selections;
- content that a renderer caps in the DOM;
- rows that were unmounted while the selection was held.

Fidelity SHALL be provided by intercepting `copy` and rebuilding the transcript
part of the clipboard text with every selected row present. It SHALL NOT depend
on which rows were mounted when copy was invoked. A row that was unmounted
contributes its text as it renders when mounted again, as it would when scrolled
back into view (for example, with row-local expansion reset). Rows brought in
only to serve the copy SHALL NOT change the transcript's scroll position, scroll
height, measured row sizes, or the selection.

A selection that starts or ends outside the transcript but contains or overlaps
it (for example, page-wide Select-All) SHALL also be intercepted. The
clipboard text SHALL be the selected text before the transcript, then the
transcript part (complete, as above), then the selected text after the
transcript. A selection that does not intersect the transcript, and any copy
invoked from an editable field (input, textarea, contenteditable), SHALL be left
to the browser's native copy. When several transcripts are on the page, exactly
one of them SHALL handle a given copy, and a copy whose range
intersects more than one transcript SHALL be declined as below rather than
truncating any of them.

When the transcript part's row span exceeds the copy ceiling, the copy SHALL NOT
place a truncated payload on the clipboard. It SHALL be declined, the
clipboard's previous contents SHALL be left unchanged, and the user SHALL be told
with a transient message that the selection is too large to copy at once. The copy ceiling SHALL depend on the primary input modality (coarse vs
fine pointer) and SHALL be at least the retained-row ceiling.

#### Scenario: Partial-node selection

- **WHEN** the user copies a selection that starts or ends mid-node inside rendered markdown
- **THEN** the clipboard text SHALL contain exactly the selected characters, extracted from the selected DOM (`Range.cloneContents()`), not the whole message

#### Scenario: Selection over a DOM-capped renderer

- **WHEN** the user copies a selection over a renderer that caps its rendered text (e.g. `AgentToolRenderer` `slice(0, 1000)`) AND that renderer exposes its full text to the copy path
- **THEN** the clipboard text SHALL contain the full selected text, not the DOM-capped prefix

#### Scenario: Copy after interior rows unmounted

- **WHEN** the user copies a selection wider than the retained-row ceiling whose interior rows are currently unmounted
- **THEN** the clipboard text SHALL contain the text of every selected row (as each row renders when mounted), in transcript order, with no row missing or duplicated

#### Scenario: Copy leaves the view undisturbed

- **WHEN** the user copies a large selection while reading mid-transcript
- **THEN** after the copy the scroll position, the scroll height, the on-screen row positions, and the selection SHALL be unchanged

#### Scenario: Page-wide Select-All includes the whole transcript

- **WHEN** the user selects the whole page (Select-All with focus outside any editable field) AND the transcript's row count is within the copy ceiling AND copies
- **THEN** the clipboard text SHALL contain the text before the transcript, every transcript row in order, and the text after the transcript

#### Scenario: Selection beyond the copy ceiling

- **WHEN** the user copies a selection whose transcript part exceeds the copy ceiling (e.g. page-wide Select-All on a very long transcript)
- **THEN** no truncated text SHALL be placed on the clipboard and the clipboard's previous contents SHALL be unchanged
- **AND** a transient "selection too large" message SHALL be shown
- **AND** the selection SHALL remain intact

#### Scenario: Selection outside the transcript keeps native copy

- **WHEN** the user copies a selection that does not intersect the transcript (e.g. inside the composer or another pane)
- **THEN** the chat view SHALL NOT intercept the copy

#### Scenario: Copy from the composer while a transcript selection exists

- **WHEN** the user copies text selected inside the composer input while a transcript selection is also present
- **THEN** the chat view SHALL NOT intercept the copy and the composer's selected text SHALL be copied natively

#### Scenario: Two transcripts on the page

- **WHEN** the page renders more than one chat transcript AND the user copies a range intersecting more than one of them
- **THEN** exactly one transcript SHALL handle the copy event
- **AND** the copy SHALL be declined (no truncated payload, previous clipboard unchanged) with a transient message to copy each transcript separately

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
gate on any suspend. Row *retention* is not a consumer of the signal. It MAY
additionally read the live browser selection when the mounted window is
recomputed, and SHALL retain the union of the rows required by the tracked
selection and by the live selection. Neither source alone SHALL decide that an
endpoint row may unmount.

#### Scenario: Chunk arrives on the first frame of a drag

- **WHEN** the user begins a drag-selection AND a streaming chunk arrives before React has committed the resulting render
- **THEN** the sticky-bottom auto-scroll SHALL already be suspended
- **AND** the view SHALL NOT scroll to the bottom

#### Scenario: Follow resumes on collapse

- **WHEN** the selection collapses AND sticky-bottom follow was armed before the selection began
- **THEN** auto-scroll follow SHALL resume without requiring further content to arrive

#### Scenario: Tracked and live selection disagree

- **WHEN** the selection has been extended but the tracked selection has not yet been updated (the browser's `selectionchange` is still pending) AND the mounted window is recomputed
- **THEN** the rows holding the live selection's endpoints SHALL stay mounted, and the rows holding the tracked selection's endpoints SHALL also stay mounted

### Requirement: Unrelated session activity does not disturb the foreground transcript

Activity in a session the user is NOT viewing — streaming assistant output,
thinking updates, tool progress, or any other per-session state change — SHALL
NOT cause the selected session's rendered transcript to be replaced in the DOM.

Specifically, rendered markdown content in the foreground transcript SHALL retain
its DOM node identity across a background session's state updates: paragraphs,
inline code, links and tables that are unchanged SHALL be reconciled in place
rather than unmounted and recreated. A browser selection anchored in that content
SHALL therefore survive background activity intact and copyable.

This SHALL hold under sustained background streaming, not merely for isolated
updates.

#### Scenario: Background stream does not collapse a foreground selection
- **GIVEN** the user holds a text selection in the transcript of the selected session
- **WHEN** a different, unselected session streams assistant output or emits thinking updates
- **THEN** the selection SHALL remain intact and copyable

#### Scenario: Foreground markdown nodes keep their identity
- **GIVEN** the selected session's transcript contains rendered paragraphs, inline code, links and a table
- **WHEN** an unselected session's state updates and no content of the selected session changed
- **THEN** those rendered markdown DOM nodes SHALL NOT be replaced

#### Scenario: Sustained background activity produces no foreground churn
- **GIVEN** the selected session's transcript is idle and rendered
- **WHEN** an unselected session emits a continuous high-rate stream of state updates
- **THEN** the selected transcript's markdown subtree SHALL undergo no node replacement
- **AND** a selection held throughout SHALL remain intact

#### Scenario: Foreground content changes still render
- **WHEN** the selected session itself receives new or updated content
- **THEN** that content SHALL render as normal
