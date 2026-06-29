## MODIFIED Requirements

### Requirement: Selection and copy preservation

Linkified spans MUST preserve native text selection across token boundaries, including selections that start on, end on, or pass over a link element. Link elements MUST NOT intercept the drag-to-select gesture: file links MUST set `user-select: text` and MUST NOT be draggable; URL links MUST NOT be draggable. A click-drag that begins on or crosses a link SHALL extend the text selection rather than initiating a native link-drag or a button press. Selecting a range that includes a link MUST yield the original verbatim text on copy (no inserted prefixes, no missing characters, no zero-width characters introduced by the renderer). Click-to-open behavior is unchanged: a plain click (no drag) on a link SHALL still open the file or URL; a drag that produces a text selection SHALL suppress the open.

#### Scenario: copy across link boundary
- **GIVEN** tool output `error in src/foo.ts:42 line`
- **WHEN** the user selects from `error` through `line` and copies
- **THEN** the clipboard SHALL contain the verbatim string `error in src/foo.ts:42 line`

#### Scenario: drag-select starting on a file link
- **GIVEN** a rendered file link for `src/foo.ts`
- **WHEN** the user presses the mouse on the link text and drags across it
- **THEN** the link text SHALL be highlighted as a text selection
- **AND** the file SHALL NOT open
- **AND** copying SHALL place `src/foo.ts` on the clipboard

#### Scenario: drag-select crossing a URL link
- **GIVEN** a rendered URL link for `https://example.com`
- **WHEN** the user drags a selection from surrounding text across the URL link
- **THEN** the selection SHALL extend through the URL text rather than starting a native link-drag
- **AND** the URL SHALL NOT open in a new tab

#### Scenario: plain click still opens
- **GIVEN** a rendered file link or URL link
- **WHEN** the user clicks the link without dragging
- **THEN** the link SHALL open (editor/preview for files, new tab for URLs) exactly as before
