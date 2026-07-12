## ADDED Requirements

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
