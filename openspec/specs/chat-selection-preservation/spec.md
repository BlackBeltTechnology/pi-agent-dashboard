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

The chat view SHALL keep streaming-tail selection behavior no worse than the
pre-change baseline. Fully preserving a selection anchored inside the actively
streaming tail card (whose committed text nodes are replaced each chunk, and
which unmounts at turn completion) is explicitly deferred to a follow-up change;
this change does not regress it.

#### Scenario: Selecting inside the streaming card
- **WHEN** the user holds a selection whose anchor is inside the streaming tail card AND new chunks arrive
- **THEN** the committed text nodes under the selection SHALL NOT be replaced until the selection collapses, after which buffered chunks SHALL flush

#### Scenario: Best-effort degradation
- **WHEN** preserving the streaming-tail selection would regress streaming latency
- **THEN** the view MAY fall back to baseline behavior, and it SHALL NOT be worse than before this change


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
