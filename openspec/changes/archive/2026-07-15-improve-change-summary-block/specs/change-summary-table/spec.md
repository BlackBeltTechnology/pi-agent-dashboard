## MODIFIED Requirements

### Requirement: Per-turn inline change block
The client SHALL render a compact change-summary block at each assistant turn boundary that has at least one Edit or Write tool call, derived entirely client-side from tool-call events grouped by `turnIndex`. The block SHALL NOT require a network round-trip and SHALL NOT invoke any language model.

Each file row SHALL lead with a **mime-type icon** keyed by the file's extension (via the shared `fileIcon()` helper, the same icon used by the editor-pane file tree), NOT a status glyph. Added-versus-modified status SHALL remain conveyed by the row's `+additions −deletions` badges.

The block's expanded state SHALL be **derived from the changed-file count** until the user manually toggles it: the block SHALL render expanded when the file count is below the collapse threshold and collapsed when the file count reaches the threshold. The collapse threshold SHALL be 8 files (collapse when `fileCount >= 8`). Once the user manually toggles the block via its header, that choice SHALL be sticky and SHALL override the derived state for the remainder of the block's lifetime, even as more files stream in. Auto-fold SHALL only ever collapse a block; expansion SHALL always be either the initial below-threshold default or a manual user action.

#### Scenario: Turn with file changes
- **WHEN** an assistant turn contains one or more Edit or Write tool calls
- **THEN** a change block SHALL render for that turn
- **AND** each changed file SHALL show a mime-type icon keyed by its extension, its path, and `+additions −deletions`
- **AND** additions/deletions SHALL be computed from the Edit `oldText`/`newText` (or Write `content`) line deltas of that turn
- **AND** the block header SHALL show an aggregate `+X −Y · N files`

#### Scenario: Turn with no file changes
- **WHEN** an assistant turn contains no Edit or Write tool calls
- **THEN** no change block SHALL render for that turn

#### Scenario: Open a file from a row
- **WHEN** the user activates the open affordance on a file row
- **THEN** the client SHALL open that file using the existing open-in-editor path (`OpenFileButton` / `POST /api/open-editor`)

#### Scenario: Small changeset stays expanded
- **WHEN** a turn changes fewer than 8 files AND the user has not manually toggled the block
- **THEN** the block SHALL render expanded, showing every file row

#### Scenario: Large changeset auto-collapses
- **WHEN** a turn changes 8 or more files AND the user has not manually toggled the block
- **THEN** the block SHALL render collapsed, showing only its one-line header (`+X −Y · N files`)

#### Scenario: Streaming turn crosses the threshold
- **GIVEN** a still-streaming turn whose block was auto-expanded at fewer than 8 files
- **AND** the user has not manually toggled it
- **WHEN** an incoming Edit or Write brings the file count to 8 or more
- **THEN** the block SHALL auto-collapse to its header so it stops displacing the surrounding messages

#### Scenario: Manual override is sticky
- **GIVEN** a block with 8 or more files
- **WHEN** the user clicks the header to expand it
- **THEN** the block SHALL stay expanded
- **AND** subsequent files streaming into the same turn SHALL NOT auto-collapse it
