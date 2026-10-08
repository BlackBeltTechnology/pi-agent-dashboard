## Purpose

Persist a displayed diagram fix back into the exact block of the on-disk file it came from, with explicit diff confirmation and conflict-safe writes that never modify anything else.

## ADDED Requirements

### Requirement: Apply-fix availability
A repaired diagram (rule- or AI-fixed) SHALL offer an "Apply fix to file" action only when the diagram originates from an on-disk file within a live session's working directory, previewed in a markdown file surface, the AsciiDoc preview, or the `.mmd`/`.mermaid` viewer. Diagrams in chat messages and other surfaces without a file identity SHALL NOT offer the action, nor SHALL markdown diagrams that do not come from a fenced code block whose language is exactly `mermaid` (for example a raw-HTML `<pre>` block). The action SHALL be disabled with an explanation while the same file has unsaved edits in the editor pane.

#### Scenario: File-backed repaired diagram
- **WHEN** a repaired diagram is shown in the preview of `docs/flow.md`
- **THEN** "Apply fix to file" is offered

#### Scenario: Chat diagram
- **WHEN** a repaired diagram is shown in a chat message
- **THEN** no "Apply fix to file" action is offered and copy-fixed remains available

#### Scenario: Unsaved editor changes
- **WHEN** the file has unsaved edits in the editor pane
- **THEN** the action is disabled and states that edits must be saved or discarded first

### Requirement: Diff confirmation before write
Activating the action SHALL first re-read and locate the block per the write-back rules, then show a line diff of the block content currently on disk versus the content that will be written, and SHALL write only after the user confirms. Cancelling SHALL write nothing.

#### Scenario: Cancel
- **WHEN** the user cancels the diff confirmation
- **THEN** the file is not modified

#### Scenario: Confirm
- **WHEN** the user confirms
- **THEN** the fix is written according to the write-back rules

### Requirement: Block-exact write-back
The client SHALL re-read the file together with its current modification token through the write-guarded read endpoint, locate the target block by its ordinal among the mermaid blocks of that file using the same parser and detection rules the preview uses, and verify that the located block, passed through the same display transform the preview applies, is exactly the source the preview rendered. For AsciiDoc the number of located mermaid blocks SHALL also equal the number the preview rendered. On confirm it SHALL replace only that block's content, preserving the fence or delimiter lines, the block's indentation and the file's line endings, and write with the file's current modification token. Any byte outside the block's content SHALL remain unchanged. For `.mmd`/`.mermaid` files the whole file content SHALL be replaced.

#### Scenario: Markdown fence replaced in place
- **WHEN** the second mermaid fence of a markdown file is applied
- **THEN** only the content between that fence's opener and closer changes, and the opener and closer lines are byte-identical

#### Scenario: Indented fence in a list
- **WHEN** the target fence is indented inside a list item
- **THEN** the written content keeps the list indentation on every line

#### Scenario: AsciiDoc source block replaced
- **WHEN** a `[source,mermaid]` block delimited by `----` is applied
- **THEN** only the lines between the delimiters change

#### Scenario: CRLF file
- **WHEN** the file uses CRLF line endings
- **THEN** the written block uses CRLF line endings

#### Scenario: Fence inside a blockquote
- **WHEN** the target mermaid fence is inside a blockquote
- **THEN** no write occurs and the action reports that the fix cannot be applied to this block

#### Scenario: Fence on a list-marker line
- **WHEN** the target mermaid fence opener shares its line with a list marker (for example `- ```mermaid`)
- **THEN** no write occurs and the action reports that the fix cannot be applied to this block

#### Scenario: AsciiDoc block count differs from the preview
- **WHEN** the raw AsciiDoc file contains a different number of mermaid source blocks than the preview rendered (for example through an include)
- **THEN** no write occurs

#### Scenario: Duplicate diagrams
- **WHEN** a file contains two identical failing diagrams and the second is applied
- **THEN** only the second block changes

### Requirement: Conflict-safe write
If the target block cannot be located, its source no longer matches the displayed original, or the server reports a modification-token conflict, the client SHALL write nothing and SHALL tell the user the file changed and offer to reload. A missing file (`404`) SHALL be treated the same way. Any other failure of the re-read or the write (network error, `403`, `500`) SHALL write nothing further, SHALL NOT retry, and SHALL show "Could not apply fix: <error>" without a reload offer.

#### Scenario: File edited externally
- **WHEN** the target block was edited on disk after the preview loaded
- **THEN** no write occurs and a "file changed — reload" message is shown

#### Scenario: Concurrent write conflict
- **WHEN** the server rejects the write with a conflict status
- **THEN** no further write is attempted and a "file changed — reload" message is shown

#### Scenario: File deleted before apply
- **WHEN** the re-read returns `404`
- **THEN** no write occurs and a "file changed — reload" message is shown

#### Scenario: Server or network failure
- **WHEN** the re-read or the write fails with a network error, `403` or `500`
- **THEN** no retry occurs and "Could not apply fix: <error>" is shown without a reload offer

### Requirement: Preview refreshes after write
After a successful write the preview SHALL reload the file and render the diagram from the written source without a repaired indication.

#### Scenario: Badge disappears
- **WHEN** an applied fix is written successfully
- **THEN** the diagram re-renders from disk with no auto-fixed or AI-fixed indication
