## MODIFIED Requirements

### Requirement: InputRenderer displays message body
The InputRenderer SHALL display `params.message` as a markdown body below the title when in pending state, using the same visual pattern as ConfirmRenderer. When resolved, the InputRenderer SHALL keep the question as the card title and display the entered value in a read-only value field (not a collapsed one-liner). An empty submitted value SHALL render as `(left blank)` in a dimmed/italic style, visually distinct from the `Cancelled` state.

#### Scenario: pending input with message
- **WHEN** an input dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` in `text-xs text-[var(--text-secondary)]` below the title and above the input field

#### Scenario: pending input without message
- **WHEN** an input dialog is pending with no `params.message`
- **THEN** the renderer SHALL display only the title (no empty body area)

#### Scenario: resolved input shows value in a field
- **WHEN** an input dialog is resolved with a non-empty value
- **THEN** the card SHALL keep the question as its title AND render the entered value in a read-only value field

#### Scenario: resolved input with empty value
- **WHEN** an input dialog is resolved with an empty string
- **THEN** the value field SHALL display `(left blank)` in a dimmed/italic style

#### Scenario: cancelled input
- **WHEN** an input dialog is cancelled
- **THEN** the card SHALL show `Cancelled` and SHALL NOT render a value field

### Requirement: SelectRenderer displays message body
The SelectRenderer SHALL display `params.message` as a markdown body below the title when in pending state. In pending state the options SHALL render as full-width vertical rows (one option per line), not horizontal wrapping buttons. Each row MAY display an optional description sub-line derived from the option text after the first ` — ` or ` · ` separator. When resolved, the SelectRenderer SHALL render the entire option list, dimmed, with the chosen option highlighted — all options SHALL be shown as asked, with no truncation, no `+N more` expander, and no folding.

#### Scenario: pending select with message
- **WHEN** a select dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` below the title and above the option rows

#### Scenario: pending select renders vertical rows
- **WHEN** a select dialog is pending with two or more options
- **THEN** each option SHALL render as a full-width row on its own line

#### Scenario: option description sub-line
- **WHEN** an option string contains a ` — ` or ` · ` separator
- **THEN** the row SHALL render the text before the separator as the option title and the text after it as a dimmed description sub-line

#### Scenario: resolved select keeps full option list
- **WHEN** a select dialog is resolved with a chosen value
- **THEN** the card SHALL render every original option, dimmed, with the chosen option highlighted
- **THEN** the card SHALL NOT collapse to show only the chosen value
- **THEN** the card SHALL NOT show a `+N more` expander regardless of option count

### Requirement: MultiselectRenderer displays message body
The MultiselectRenderer SHALL display `params.message` as a markdown body below the title when in pending state. In pending state the options SHALL render as full-width vertical checkbox rows with the existing Select-all toggle and live selection count. When resolved, the MultiselectRenderer SHALL render the entire option list with the selected options highlighted/checked and the unselected options shown dimmed/unchecked — all options SHALL be shown as asked, with no truncation, no `+N more` expander, and no folding.

#### Scenario: pending multiselect with message
- **WHEN** a multiselect dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` below the title and above the checkbox rows

#### Scenario: resolved multiselect keeps full option list
- **WHEN** a multiselect dialog is resolved with a set of selected values
- **THEN** the card SHALL render every original option, with selected options highlighted/checked and unselected options dimmed/unchecked
- **THEN** the card SHALL show a count summary (e.g. `2 of 3`)
- **THEN** the card SHALL NOT collapse to show only the selected values

## ADDED Requirements

### Requirement: ConfirmRenderer uses Yes/No labels
The ConfirmRenderer SHALL label its affirmative and negative actions `Yes` and `No` (not `Allow` and `Deny`). The affirmative action SHALL retain green styling and the negative action SHALL retain red styling. When resolved, the card SHALL show both `Yes` and `No` with the chosen option highlighted.

#### Scenario: pending confirm labels
- **WHEN** a confirm dialog is pending
- **THEN** the affirmative button SHALL read `Yes` (green) and the negative button SHALL read `No` (red)

#### Scenario: resolved confirm shows both options
- **WHEN** a confirm dialog is resolved
- **THEN** the card SHALL render both `Yes` and `No` with the chosen option highlighted

### Requirement: BatchRenderer renders a wizard
A `batch` interactive request SHALL render as a single wizard card via a BatchRenderer registered for the `batch` method. The wizard SHALL present one sub-question per page with a stepper header indicating progress, `Back` and `Next` navigation, and a final Review page listing every collected answer with a per-row `Edit` action that returns to the corresponding step. Sub-question answers SHALL be held in client state and SHALL NOT be sent to the bridge until the user submits on the Review page. A sub-question of method `multiselect` SHALL allow multiple selected answers for that single step, rendered as a pill group in the step, the Review page, and the resolved summary.

#### Scenario: wizard shows one question per page
- **WHEN** a `batch` request with N sub-questions is pending
- **THEN** the wizard SHALL display one sub-question at a time with a stepper showing N steps

#### Scenario: navigate back and forward
- **WHEN** the user has answered step 1 and advanced to step 2
- **THEN** a `Back` control SHALL return to step 1 with its prior answer preserved

#### Scenario: review and edit before submit
- **WHEN** the user reaches the Review page after answering all steps
- **THEN** the page SHALL list every question and its answer with a per-row `Edit` action
- **WHEN** the user clicks `Edit` on a row
- **THEN** the wizard SHALL return to that step with all other answers preserved

#### Scenario: multiselect step yields multiple answers
- **WHEN** a batch sub-question uses method `multiselect` and the user checks two options
- **THEN** that step's answer SHALL contain both values, rendered as a pill group

#### Scenario: answers withheld until submit
- **WHEN** the user is navigating the wizard before the Review submit
- **THEN** no answer SHALL be sent to the bridge
- **WHEN** the user submits on the Review page
- **THEN** all answers SHALL be sent as a single response

#### Scenario: resolved batch shows read-only summary
- **WHEN** a `batch` request is resolved
- **THEN** the card SHALL render a read-only Q→A summary of every question and answer with no Back/Next/Edit controls
