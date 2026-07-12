## MODIFIED Requirements

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
