## REMOVED Requirements

### Requirement: OpenFileButton preview fallback when no editor

**Reason**: Superseded by the split-button behavior below. The default click now opens the internal Monaco editor pane (not the preview overlay), and detected native editors move to a dropdown. `OpenFileButton` still renders whenever a `cwd` + `filePath` are present, never hidden merely because no editor is detected.

## ADDED Requirements

### Requirement: OpenFileButton SHALL be a split button defaulting to the internal pane

`OpenFileButton` SHALL render as a split control with two affordances:

1. **Body click** — opens the file in the internal Monaco editor pane via `buildEditorUrl(sessionId, filePath, line?)` route navigation.
2. **Caret dropdown** — lists detected native editors (e.g., Zed) as alternates. Selecting an entry invokes the existing `openEditor(cwd, editor.id, filePath, line)` flow unchanged.

When no native editors are detected, the dropdown caret SHALL be hidden and the button SHALL render as a plain "Open" control invoking the internal pane. (Today's behavior of hiding the entire button when no native editor exists is REMOVED — the button now appears whenever a `filePath` is present.)

The button SHALL appear on every tool-card renderer that today renders it (`EditToolRenderer`, `WriteToolRenderer`, `ReadToolRenderer`, `MultiEditToolRenderer` if present). The presence of a `cwd` SHALL still be required; the button SHALL NOT render in the rare case where the tool call has no resolvable cwd.

The dropdown ordering SHALL match the existing `editors` array order. The dropdown SHALL be a standard popover with keyboard navigation (arrow keys + Enter, Escape to dismiss).

#### Scenario: Click opens internal pane
- **GIVEN** a session with Zed detected as a native editor
- **WHEN** the user clicks the `OpenFileButton` body for `src/foo.ts`
- **THEN** the URL navigates to `/session/:id/editor?file=src/foo.ts`
- **AND** the editor pane opens with `src/foo.ts` as the active tab

#### Scenario: Dropdown opens external editor
- **GIVEN** a session with Zed detected as a native editor
- **WHEN** the user opens the `OpenFileButton` dropdown
- **AND** selects "Open in Zed"
- **THEN** the existing `openEditor(cwd, "zed", "src/foo.ts", line)` flow runs
- **AND** the dashboard does NOT navigate to the internal editor route

#### Scenario: No native editor detected hides dropdown
- **GIVEN** a session with NO native editors detected
- **WHEN** the user views a tool card with a file path
- **THEN** the `OpenFileButton` renders as a plain "Open" button with no caret affordance
- **AND** clicking the button opens the internal editor pane

#### Scenario: Button renders even without native editor
- **GIVEN** a session with NO native editors detected
- **AND** an `EditToolRenderer` showing a file path
- **WHEN** the chat renders
- **THEN** the `OpenFileButton` is visible (today's behavior would hide it)
- **AND** clicking it opens the internal pane

#### Scenario: Keyboard navigation through dropdown
- **GIVEN** two detected native editors and the dropdown is open
- **WHEN** the user presses ArrowDown then Enter
- **THEN** the second native editor is selected and invoked
- **WHEN** the user presses Escape with the dropdown open
- **THEN** the dropdown closes without invoking any editor
