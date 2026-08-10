## MODIFIED Requirements

### Requirement: InputRenderer displays message body

The InputRenderer SHALL display `params.message` as a markdown body below the title
when in pending state, using the same visual pattern as ConfirmRenderer. The
InputRenderer SHALL also display `params.message` as a markdown body in the resolved
state, so the description remains visible after the user answers. When resolved, the
InputRenderer SHALL keep the question as the card title and display the entered value
in a read-only value field (not a collapsed one-liner). An empty submitted value SHALL
render as `(left blank)` in a dimmed/italic style, visually distinct from the
`Cancelled` state.

#### Scenario: pending input with message
- **WHEN** an input dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` in
  `text-xs text-[var(--text-secondary)]` below the title and above the input field

#### Scenario: resolved input with message
- **WHEN** an input dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title
  and above the read-only value field

#### Scenario: pending input without message
- **WHEN** an input dialog is pending with no `params.message`
- **THEN** the renderer SHALL display only the title (no empty body area)

#### Scenario: resolved input shows value in a field
- **WHEN** an input dialog is resolved with a non-empty value
- **THEN** the card SHALL keep the question as its title AND render the entered value
  in a read-only value field

#### Scenario: resolved input with empty value
- **WHEN** an input dialog is resolved with an empty string
- **THEN** the value field SHALL display `(left blank)` in a dimmed/italic style

#### Scenario: cancelled input
- **WHEN** an input dialog is cancelled
- **THEN** the card SHALL show `Cancelled` and SHALL NOT render a value field

### Requirement: SelectRenderer displays message body

The SelectRenderer SHALL display `params.message` as a markdown body below the title
when in pending state. The SelectRenderer SHALL also display `params.message` as a
markdown body in the resolved state, below the title and above the option list. In
pending state the options SHALL render as full-width vertical rows (one option per
line), not horizontal wrapping buttons. Each row MAY display an optional description
sub-line derived from the option text after the first ` — ` or ` · ` separator. When
resolved, the SelectRenderer SHALL render the entire option list, dimmed, with the
chosen option highlighted — all options SHALL be shown as asked, with no truncation,
no `+N more` expander, and no folding.

#### Scenario: pending select with message
- **WHEN** a select dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` below the
  title and above the option rows

#### Scenario: resolved select with message
- **WHEN** a select dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title
  and above the dimmed option list

#### Scenario: pending select renders vertical rows
- **WHEN** a select dialog is pending with two or more options
- **THEN** each option SHALL render as a full-width row on its own line

#### Scenario: option description sub-line
- **WHEN** an option string contains a ` — ` or ` · ` separator
- **THEN** the row SHALL render the text before the separator as the option title and
  the text after it as a dimmed description sub-line

#### Scenario: resolved select keeps full option list
- **WHEN** a select dialog is resolved with a chosen value
- **THEN** the card SHALL render every original option, dimmed, with the chosen option
  highlighted
- **THEN** the card SHALL NOT collapse to show only the chosen value
- **THEN** the card SHALL NOT show a `+N more` expander regardless of option count

### Requirement: MultiselectRenderer displays message body

The MultiselectRenderer SHALL display `params.message` as a markdown body below the
title when in pending state. The MultiselectRenderer SHALL also display
`params.message` as a markdown body in the resolved state, below the title and above
the option list. In pending state the options SHALL render as full-width vertical
checkbox rows with the existing Select-all toggle and live selection count. When
resolved, the MultiselectRenderer SHALL render the entire option list with the
selected options highlighted/checked and the unselected options shown
dimmed/unchecked — all options SHALL be shown as asked, with no truncation, no
`+N more` expander, and no folding.

#### Scenario: pending multiselect with message
- **WHEN** a multiselect dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` below the
  title and above the checkbox rows

#### Scenario: resolved multiselect with message
- **WHEN** a multiselect dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title
  and above the option list

#### Scenario: resolved multiselect keeps full option list
- **WHEN** a multiselect dialog is resolved with a set of selected values
- **THEN** the card SHALL render every original option, with selected options
  highlighted/checked and unselected options dimmed/unchecked
- **THEN** the card SHALL show a count summary (e.g. `2 of 3`)
- **THEN** the card SHALL NOT collapse to show only the selected values

### Requirement: ConfirmRenderer uses Yes/No labels

The ConfirmRenderer SHALL label its affirmative and negative actions `Yes` and `No`
(not `Allow` and `Deny`). The affirmative action SHALL retain green styling and the
negative action SHALL retain red styling. The ConfirmRenderer SHALL display
`params.message` as a markdown body below the title in both the pending and resolved
states, so the description remains visible after the user answers. When resolved, the
card SHALL show both `Yes` and `No` with the chosen option highlighted.

#### Scenario: pending confirm labels
- **WHEN** a confirm dialog is pending
- **THEN** the affirmative button SHALL read `Yes` (green) and the negative button
  SHALL read `No` (red)

#### Scenario: pending confirm with message
- **WHEN** a confirm dialog is pending with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title

#### Scenario: resolved confirm with message
- **WHEN** a confirm dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title
  and above the Yes/No summary

#### Scenario: resolved confirm shows both options
- **WHEN** a confirm dialog is resolved
- **THEN** the card SHALL render both `Yes` and `No` with the chosen option
  highlighted
