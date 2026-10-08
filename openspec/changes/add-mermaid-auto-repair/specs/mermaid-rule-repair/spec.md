## Purpose

Deterministic, client-side repair of common Mermaid syntax failures so a diagram that fails to render is retried with a mechanically fixed source, with every repair made visible to the user.

## ADDED Requirements

### Requirement: Rule-based repair runs only on failed renders
When rendering a complete mermaid block fails, the renderer SHALL apply a deterministic rule-based repair to the normalized source (whitespace-trimmed, HTML entities decoded, common indentation removed) and retry rendering with the repaired source. A block whose original source renders successfully SHALL NOT be repaired. A block that is still streaming (fence not yet closed) SHALL NOT be repaired.

#### Scenario: Valid diagram is untouched
- **WHEN** a mermaid block renders successfully from its original source
- **THEN** no repair is attempted and no auto-fixed indication is shown

#### Scenario: Repairable diagram renders after repair
- **WHEN** a sequence diagram declares `participant end` and fails to render
- **THEN** the renderer repairs the alias and displays the rendered diagram

#### Scenario: Keyword alias inside a block
- **WHEN** a sequence diagram declares `participant end`, uses it in messages, and contains an `alt … end` block
- **THEN** the alias is renamed in the declaration and messages, the block terminator `end` is left unchanged, and the diagram renders

#### Scenario: Streaming block is not repaired
- **WHEN** a mermaid block's closing fence has not yet arrived
- **THEN** neither render nor repair is attempted

### Requirement: Repair rule set
The repair SHALL cover these failure classes, identified by these codes and applied in this order: (R1) byte-order mark and zero-width characters (U+200B–U+200D, U+2060, U+FEFF), or a stray leading `mermaid` line; (R2) sequence-diagram participant/actor aliases that collide with sequence keywords, renamed consistently in declarations and messages to a name that collides with no existing identifier, never renaming a line consisting solely of the block terminator `end`; (R3) unbalanced sequence blocks (`alt`/`loop`/`opt`/`par`/`critical`/`rect`/`break`/`box` without `end`, or surplus `end`); (R6) ER-diagram attribute types containing non-word characters; (R4) unquoted flowchart edge labels directly attached to an edge operator, quoted, never touching text between edges or pipes inside quoted labels; (R5) flowchart node labels containing special characters, quoted, whether followed by whitespace, an edge operator or end of line, never inside an already-quoted label; (R7) inside quoted flowchart labels, `;` replaced by `,` and `#` replaced by `no.`, leaving mermaid entity escapes (`#name;`, `#123;`) unchanged. A rule SHALL only alter diagrams of the kind it targets. Diagram kind SHALL be determined after skipping a leading YAML frontmatter block and comment lines, and any `flowchart-*` variant SHALL count as a flowchart.

#### Scenario: Unclosed sequence block is balanced
- **WHEN** a sequence diagram opens `alt` and never closes it
- **THEN** the repaired source closes the block with `end`

#### Scenario: Special characters in a node label are quoted
- **WHEN** a flowchart contains `A[call X (commit)]` and fails to render
- **THEN** the repaired source contains `A["call X (commit)"]`

#### Scenario: Node label directly followed by an edge
- **WHEN** a failing flowchart contains `A[call X (commit)]-->B`
- **THEN** the repaired source contains `A["call X (commit)"]-->B`

#### Scenario: Two edge labels on one line
- **WHEN** a failing flowchart contains `A -->|yes| B -->|no| C`
- **THEN** the repaired source contains `A -->|"yes"| B -->|"no"| C` and repairing it again changes nothing

#### Scenario: Pipes inside a quoted label untouched
- **WHEN** a failing flowchart contains `A["a|b|c"]`
- **THEN** that label is unchanged by repair

#### Scenario: Mermaid entity escapes preserved
- **WHEN** a failing flowchart contains the label `A["say #quot;hi#quot;; now"]`
- **THEN** the `;` separator is replaced and both `#quot;` escapes are unchanged

#### Scenario: Frontmatter diagram is repairable
- **WHEN** a failing flowchart starts with a `---` frontmatter block and contains `A[x (y)]`
- **THEN** the flowchart rules apply and the label is quoted

#### Scenario: Rule does not touch other diagram kinds
- **WHEN** an ER diagram fails to render
- **THEN** flowchart and sequence rules make no change to it

### Requirement: Repair is pure and idempotent
The repair SHALL be a pure function of the source text: the same input SHALL always produce the same repaired source and the same list of applied rules, and repairing an already-repaired source SHALL apply no further rules.

#### Scenario: Repair is deterministic
- **WHEN** the same failing source is repaired twice
- **THEN** both results have identical source and identical applied-rule lists

#### Scenario: Repair is idempotent
- **WHEN** a repaired source is passed to repair again
- **THEN** the applied-rule list is empty and the source is unchanged

### Requirement: Repair is bounded in time
Repairing a source of up to 50 000 characters SHALL complete in under 100 ms, including inputs constructed to maximize regex backtracking (long lines of unbalanced brackets, pipes and quotes).

#### Scenario: Near-limit source
- **WHEN** a failing flowchart of 50 000 characters is repaired
- **THEN** repair returns in under 100 ms

#### Scenario: Pathological source
- **WHEN** a 50 000-character source consisting of one line of alternating `[`, `(`, `|` and `"` characters is repaired
- **THEN** repair returns in under 100 ms

### Requirement: Repaired diagrams are visibly marked
A diagram rendered from repaired source SHALL display an auto-fixed indication listing the applied rule codes, each with a localized description exposed to assistive technology, a control to show the original source (as received, before normalization) together with the original render error, and a control to copy the repaired source. The repaired source is the source exactly as rendered: the normalized input with the listed rules applied. The controls SHALL be keyboard-operable and expose their state to assistive technology. While the original is shown, the diagram and its zoom controls SHALL be neither visible nor keyboard-reachable. Toggling back SHALL restore the diagram with its previous zoom and pan, or its fitted scale if it was never zoomed. When the rendered outcome changes (new source or theme), the original view SHALL be closed.

#### Scenario: Badge names applied rules
- **WHEN** a diagram renders after rules R4 and R5 were applied
- **THEN** an auto-fixed indication listing R4 and R5 is shown with the diagram, each with a description

#### Scenario: Show original
- **WHEN** the user activates "show original" on a repaired diagram
- **THEN** the original source and the original render error are displayed instead of the diagram, and the diagram's controls cannot be reached by keyboard

#### Scenario: Toggle back keeps zoom
- **WHEN** the user zoomed a repaired diagram, showed the original, then toggled back
- **THEN** the diagram has the same zoom and pan as before

#### Scenario: Toggle back keeps fitted scale
- **WHEN** the user never zoomed a repaired diagram, showed the original, then toggled back
- **THEN** the diagram is shown at its fitted scale

#### Scenario: Show original after remount
- **WHEN** a repaired diagram is remounted from cache and the user activates "show original"
- **THEN** the original source and the original render error are displayed

#### Scenario: Outcome change closes the original view
- **WHEN** the original view is open and the diagram's source or theme changes
- **THEN** the original view closes and the new outcome is displayed

#### Scenario: Copy fixed source
- **WHEN** the user activates "copy fixed" on a repaired diagram
- **THEN** the repaired source is placed on the clipboard

### Requirement: Unrepairable diagrams keep the error display
When no rule applies, or the repaired source also fails to render, the renderer SHALL display the original source with the error message from the original render attempt.

#### Scenario: No rule applies
- **WHEN** a diagram uses an unknown diagram type
- **THEN** the raw original code and the original error are displayed and no auto-fixed indication is shown

#### Scenario: Repair still fails
- **WHEN** rules apply but the repaired source still fails to render
- **THEN** the raw original code and the original error are displayed
