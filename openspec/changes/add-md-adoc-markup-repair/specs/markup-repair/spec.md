## Purpose

On-demand repair of Markdown and AsciiDoc markup that mis-renders (unterminated or mismatched blocks, bare mermaid style blocks) in file previews, displayed with a visible repair notice and persistable through a diff-confirmed write.

## ADDED Requirements

### Requirement: Markup repair is limited to file previews
Markup repair SHALL apply only to documents previewed from an on-disk file (every on-disk preview surface, including canvas and OpenSpec artifact previews). Markdown repair SHALL only repair top-level fences, never fences inside blockquotes or list items, and SHALL never treat YAML frontmatter as a fence. Chat messages, thinking blocks and any streaming content SHALL NOT be markup-repaired and SHALL keep the streaming completeness gate for mermaid fences.

#### Scenario: Chat message untouched
- **WHEN** a chat message contains an unclosed fence
- **THEN** no markup repair is applied and no repair notice is shown

#### Scenario: File preview repaired
- **WHEN** a previewed `.md` file contains an unterminated fence followed by a blank line and a heading
- **THEN** the preview renders the heading and following content as markdown and shows a repair notice

#### Scenario: Frontmatter and quoted fences untouched
- **WHEN** a previewed `.md` file has YAML frontmatter containing a line of three backticks, or an unterminated fence inside a `>` blockquote
- **THEN** no repair is applied and no repair notice is shown

### Requirement: Mermaid fence at end of a file renders
In a markdown file preview, every mermaid fence SHALL be treated as complete and rendered, including a fence not closed before the end of the file and a tilde (`~~~`) fence, instead of waiting indefinitely. This SHALL NOT be reported as a repair and SHALL NOT change the file.

#### Scenario: Unclosed mermaid fence at EOF
- **WHEN** a previewed `.md` file ends inside a ```` ```mermaid ```` fence with a valid diagram
- **THEN** the diagram renders, no loading placeholder remains and no repair notice is shown

#### Scenario: Tilde mermaid fence
- **WHEN** a previewed `.md` file contains a `~~~mermaid` fence closed by `~~~`
- **THEN** the diagram renders and no loading placeholder remains

### Requirement: Markdown block repair rules
A fenced code block is unterminated when no closing fence (same character, length at least the opener's, indented at most 3 spaces) follows it before the end of the file. For an unterminated fenced code block in a markdown file preview, the repair SHALL replace the first following line consisting solely of three or more fence characters of the other fence character, or of the same character but shorter than the opener, with a valid closing fence (M2); otherwise it SHALL insert a closing fence before the blank line that precedes the first following ATX heading (M3); otherwise it SHALL apply no repair. A replaced line SHALL keep its own line ending and an inserted line SHALL use the block opener line's line ending. A fence that is properly closed SHALL NOT be altered.

#### Scenario: Mismatched closer character
- **WHEN** a fence opened with ```` ``` ```` is followed later by a line `~~~` and never closed
- **THEN** that line is replaced by a closing ```` ``` ```` and the remainder renders as markdown

#### Scenario: Shorter closer
- **WHEN** a fence opened with ```` ```` ```` is followed later by a line ```` ``` ```` and never closed
- **THEN** that line is replaced by a closing ```` ```` ````

#### Scenario: Properly closed fence documenting a fence
- **WHEN** a ```` ```` ```` fence contains a ```` ``` ```` line and is closed by ```` ```` ````
- **THEN** no repair is applied

### Requirement: AsciiDoc repair rules
The AsciiDoc preview SHALL render a bare `[mermaid]` or `[mermaid,…]` style applied to a `----` or `....` delimited block (optionally with block title or anchor lines between the style and the delimiter) as a mermaid source block so it hydrates as a diagram (A1); a `[mermaid]` style on a non-delimited paragraph SHALL NOT be rewritten. An unterminated `----` or `....` block that is not nested inside another delimited block SHALL have the first following delimiter line of the same character but different length replaced by the opener's exact delimiter, otherwise a closing delimiter SHALL be inserted before the blank line that precedes the next section title, otherwise no repair applies (A2). Other delimited block types SHALL NOT be repaired. Repair detection SHALL be a pure scan of the source, independent of converter diagnostics. The repair SHALL NOT introduce passthrough content, include directives or document attributes, and rendering SHALL remain in secure mode.

#### Scenario: Bare mermaid block hydrates
- **WHEN** a previewed `.adoc` contains a bare `[mermaid]` block delimited by `----`
- **THEN** it renders as a mermaid diagram and the repair notice lists A1 with its line

#### Scenario: Delimiter length mismatch
- **WHEN** a listing opened with `----` is followed later by `-----` and never closed
- **THEN** the `-----` line is replaced by `----`

#### Scenario: Unterminated block before a section
- **WHEN** a listing block is never closed and a section title `== Next` follows
- **THEN** the block is closed before `== Next` and the section renders as a heading

### Requirement: Repairs are visible and reversible in view
A repaired document SHALL show a document-level notice listing each applied repair with its line number in the original source (the block opener line; for A1 the attribute line), and a control to view the original (unrepaired) rendering; for AsciiDoc the original rendering SHALL be fetched only when the control is first activated. The notice SHALL appear on every surface that renders the file preview (overlay and editor pane).

#### Scenario: Notice lists repairs
- **WHEN** an `.adoc` file gets repairs A2 at line 42 and A1 at line 88
- **THEN** the notice lists both with their line numbers

#### Scenario: View original rendering
- **WHEN** the user activates "view original rendering"
- **THEN** the rendering without markup repairs is shown (mermaid fences still render as complete) and the control restores the repaired rendering

### Requirement: Markup fix can be applied to the file
The notice SHALL offer "Apply markup fix to file" under the same availability rules as per-diagram "Apply fix to file" (surfaces that provide the file identity; disabled with an explanation while the file has unsaved edits in the editor pane); elsewhere the notice SHALL show without the apply action. It SHALL re-read the file and verify it is unchanged since it was displayed (markdown: content byte-equal to the displayed content; AsciiDoc: modification token equal to the one returned with the rendering), then show a diff of the current versus repaired file content and write the repaired content only on confirmation. A mismatch or a modification-token conflict SHALL write nothing and offer a reload. After a successful write the preview SHALL reload with no repair notice.

#### Scenario: Apply succeeds
- **WHEN** the user confirms the diff and the file is unchanged on disk
- **THEN** the repaired content is written and the preview reloads without a repair notice

#### Scenario: File changed meanwhile
- **WHEN** the file was modified on disk after the preview loaded
- **THEN** nothing is written and a "file changed — reload" message is shown

### Requirement: Per-diagram apply waits for markup apply
While a markup repair is displayed but not applied, per-diagram "Apply fix to file" actions in that document SHALL be disabled with an explanation that the markup fix must be applied first. They SHALL become available again once the document reloads without a markup repair.

#### Scenario: Diagram apply disabled
- **WHEN** a document shows an unapplied markup repair and contains an auto-fixed diagram
- **THEN** the diagram's apply action is disabled and says to apply the markup fix first

### Requirement: Repair is pure and idempotent
Markup repair SHALL be a deterministic function of the source text, and repairing already-repaired source SHALL apply no further repairs. Display and apply SHALL use the same repair function per format. Repair line numbers SHALL refer to the original source, and a repair SHALL change no bytes outside the inserted or replaced lines (each line keeps its own line ending).

#### Scenario: Idempotent
- **WHEN** repaired source is repaired again
- **THEN** no repairs are reported and the source is unchanged
