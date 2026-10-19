# interactive-renderers Specification

## Purpose
TBD - created by archiving change ask-user-message-body. Update Purpose after archive.

## Requirements

### Requirement: InputRenderer displays message body
The InputRenderer SHALL display `params.message` as a markdown body below the title when in pending state, using the same visual pattern as ConfirmRenderer. The InputRenderer SHALL also display `params.message` as a markdown body in the resolved state, so the description remains visible after the user answers. When resolved, the InputRenderer SHALL keep the question as the card title and display the entered value in a read-only value field (not a collapsed one-liner). An empty submitted value SHALL render as `(left blank)` in a dimmed/italic style, visually distinct from the `Cancelled` state.

#### Scenario: pending input with message
- **WHEN** an input dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` in `text-xs text-[var(--text-secondary)]` below the title and above the input field

#### Scenario: resolved input with message
- **WHEN** an input dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title and above the read-only value field

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
The SelectRenderer SHALL display `params.message` as a markdown body below the title when in pending state. The SelectRenderer SHALL also display `params.message` as a markdown body in the resolved state, below the title and above the option list. In pending state the options SHALL render as full-width vertical rows (one option per line), not horizontal wrapping buttons. Each row MAY display an optional description sub-line derived from the option text after the first ` — ` or ` · ` separator. When resolved, the SelectRenderer SHALL render the entire option list, dimmed, with the chosen option highlighted — all options SHALL be shown as asked, with no truncation, no `+N more` expander, and no folding.

#### Scenario: pending select with message
- **WHEN** a select dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` below the title and above the option rows

#### Scenario: resolved select with message
- **WHEN** a select dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title and above the dimmed option list

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
The MultiselectRenderer SHALL display `params.message` as a markdown body below the title when in pending state. The MultiselectRenderer SHALL also display `params.message` as a markdown body in the resolved state, below the title and above the option list. In pending state the options SHALL render as full-width vertical checkbox rows with the existing Select-all toggle and live selection count. When resolved, the MultiselectRenderer SHALL render the entire option list with the selected options highlighted/checked and the unselected options shown dimmed/unchecked — all options SHALL be shown as asked, with no truncation, no `+N more` expander, and no folding.

#### Scenario: pending multiselect with message
- **WHEN** a multiselect dialog is pending with `params.message` set
- **THEN** the renderer SHALL display the message as `<MarkdownContent>` below the title and above the checkbox rows

#### Scenario: resolved multiselect with message
- **WHEN** a multiselect dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title and above the option list

#### Scenario: resolved multiselect keeps full option list
- **WHEN** a multiselect dialog is resolved with a set of selected values
- **THEN** the card SHALL render every original option, with selected options highlighted/checked and unselected options dimmed/unchecked
- **THEN** the card SHALL show a count summary (e.g. `2 of 3`)
- **THEN** the card SHALL NOT collapse to show only the selected values

### Requirement: ConfirmRenderer uses Yes/No labels
The ConfirmRenderer SHALL label its affirmative and negative actions `Yes` and `No` (not `Allow` and `Deny`). The affirmative action SHALL retain green styling and the negative action SHALL retain red styling. The ConfirmRenderer SHALL display `params.message` as a markdown body below the title in both the pending and resolved states, so the description remains visible after the user answers. When resolved, the card SHALL show both `Yes` and `No` with the chosen option highlighted.

#### Scenario: pending confirm labels
- **WHEN** a confirm dialog is pending
- **THEN** the affirmative button SHALL read `Yes` (green) and the negative button SHALL read `No` (red)

#### Scenario: pending confirm with message
- **WHEN** a confirm dialog is pending with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title

#### Scenario: resolved confirm with message
- **WHEN** a confirm dialog is resolved with `params.message` set
- **THEN** the card SHALL display the message as `<MarkdownContent>` below the title and above the Yes/No summary

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

### Requirement: Select prompts offer an inline Other answer
A pending `select` prompt SHALL render an "Other" row after its listed options (before the Cancel row) whenever the inline Other answer is enabled for that prompt. Activating the "Other" row SHALL reveal a single-line text field inside the card, move keyboard focus to it, and show a Submit control. Submitting SHALL respond with `{ value: <text> }`, where `<text>` is the typed text with leading and trailing whitespace removed. Submit SHALL be disabled, and Enter SHALL do nothing, while the trimmed text is empty. The text field SHALL carry an accessible label. Pressing Escape in the text field SHALL collapse it without responding and SHALL be consumed, so no enclosing layer (the question dialog, or any Escape-dismissable surface) also handles that key press. In the question dialog, that Escape SHALL NOT close the dialog. Clicking a listed option SHALL keep responding immediately with that option. Every new visible string ("Other", the field label, the resolved "Other" row label) SHALL go through the i18n layer, with keys present in every shipped locale.

#### Scenario: User answers with custom text
- **WHEN** a `select` prompt with options `["A", "B"]` is pending and the inline Other answer is enabled
- **AND** the user activates "Other", types `  something else  ` and presses Enter
- **THEN** the renderer SHALL respond with `{ value: "something else" }`

#### Scenario: Empty custom text cannot be submitted
- **WHEN** the user has activated "Other" and the text field is empty or whitespace-only
- **THEN** Submit SHALL be disabled and Enter SHALL NOT respond

#### Scenario: Other is keyboard-operable
- **WHEN** the user tabs to the "Other" row and presses Enter or Space
- **THEN** the text field SHALL appear with keyboard focus
- **WHEN** the user presses Escape in the text field
- **THEN** the field SHALL collapse and no response SHALL be sent

#### Scenario: Escape inside the question dialog collapses Other only
- **WHEN** the question dialog shows a `select` question with "Other" active and focus in its text field
- **AND** the user presses Escape
- **THEN** the text field SHALL collapse and the dialog SHALL stay open
- **WHEN** the user presses Escape again with focus outside the text field
- **THEN** the dialog SHALL close as before

#### Scenario: Listed options still answer in one click
- **WHEN** the user clicks option `"A"` while the inline Other answer is enabled
- **THEN** the renderer SHALL respond with `{ value: "A" }` without showing a text field

### Requirement: Multiselect prompts offer an inline Other answer
A pending `multiselect` prompt SHALL render an "Other" checkbox row after its listed options whenever the inline Other answer is enabled for that prompt. Checking it SHALL reveal a labelled text field and move focus to it. On Submit the trimmed text SHALL be appended to `values` after the checked listed options; if the trimmed text exactly equals a listed option (case-sensitive), that option SHALL appear in `values` once. Submit SHALL be disabled while "Other" is checked and its trimmed text is empty. Unchecking "Other" SHALL exclude the text from `values`. The "Select all" toggle SHALL affect only the listed options; it SHALL NOT change the "Other" row's checked state or its text. The Submit count SHALL include the custom value when it is included.

#### Scenario: Custom value alongside checked options
- **WHEN** a `multiselect` prompt with options `["A", "B", "C"]` is pending, the user checks `"A"`, checks "Other" and types `"D"`
- **AND** the user clicks Submit
- **THEN** the renderer SHALL respond with `{ values: ["A", "D"] }`

#### Scenario: Only a custom value
- **WHEN** the user checks only "Other", types `"Z"` and submits
- **THEN** the renderer SHALL respond with `{ values: ["Z"] }`

#### Scenario: Custom text equal to an option is not duplicated
- **WHEN** the user checks `"A"`, checks "Other", types `"A"` and submits
- **THEN** the renderer SHALL respond with `{ values: ["A"] }`

#### Scenario: Other checked with empty text blocks submit
- **WHEN** "Other" is checked and its text is empty or whitespace-only
- **THEN** Submit SHALL be disabled

#### Scenario: Select all ignores Other
- **WHEN** the user activates "Select all"
- **THEN** every listed option SHALL be checked and the "Other" row SHALL keep its current state

### Requirement: Batch select and multiselect steps offer an inline Other answer
In a `batch` wizard, every `select` and `multiselect` step SHALL offer the same inline "Other" row as the single-prompt renderers, governed by that sub-question's own enablement. A `select` step answered via "Other" SHALL record `{ value: <trimmed text> }`; a `multiselect` step SHALL record the trimmed text inside `values`. `Next` SHALL be disabled while the step's "Other" is chosen or checked with empty trimmed text. The chosen-or-checked state of "Other" and its text SHALL be held in the wizard's per-step state (not in a component that unmounts between steps), so both SHALL survive `Back`/`Next`/`Edit` navigation and SHALL appear on the Review page and in the resolved summary like any other answer (a pill for multiselect). `confirm` and `input` steps SHALL NOT show an "Other" row.

#### Scenario: Custom answer on a select step
- **WHEN** a batch select step with options `["A", "B"]` is answered by choosing "Other" and typing `"C"`
- **AND** the user submits on the Review page
- **THEN** that step's entry in `answers` SHALL be `{ value: "C" }`

#### Scenario: Custom value on a multiselect step
- **WHEN** a batch multiselect step has `"A"` checked plus "Other" with text `"D"`
- **THEN** that step's entry SHALL be `{ values: ["A", "D"] }` and the Review page SHALL show `A` and `D` as pills

#### Scenario: Custom text preserved across navigation
- **WHEN** the user types custom text on step 1, advances to step 2 and presses `Back`
- **THEN** step 1 SHALL show "Other" chosen with the same text

#### Scenario: Next blocked on empty custom text
- **WHEN** "Other" is chosen on the current step and its text is empty
- **THEN** `Next` SHALL be disabled

### Requirement: Inline Other enablement and suppression
The inline "Other" row SHALL be opt-in. It SHALL be shown on a `select` or `multiselect` prompt (or a batch `select`/`multiselect` sub-question) only when that prompt or sub-question carries `allowOther: true`. Every other prompt SHALL render exactly as before.

Even when opted in, the row SHALL be hidden when one of the listed options is already an "Other" option. An option counts when its text, with leading and trailing whitespace trimmed, is the word "Other" on its own or followed by a character that is neither a letter nor a digit (any script), case-insensitive. Non-string options never count. The rule is English-only. This matches `"Other (describe)"`, `"other"`, `" Other: specify"` and `"Other — describe"`, but not `"Others"`, `"Otherwise"` or `"Other1"`.

`confirm`, `input` and `editor` prompts SHALL never show an "Other" row. The dashboard and the server SHALL decide enablement with one shared definition, which uses the opt-in flag and the options, so a surface shows the row exactly when the REST answer road accepts a custom answer. A prompt with no listed options SHALL NOT be enabled. The same rules SHALL apply wherever the renderers are mounted: the inline chat card, the grouped free-floating panel and the pending-question dialog.

#### Scenario: Off by default
- **WHEN** a `select` prompt arrives with no `allowOther` field
- **THEN** the card SHALL NOT show an inline "Other" row and SHALL render exactly as before this change

#### Scenario: Opted in
- **WHEN** a `select` prompt carries `allowOther: true`
- **THEN** the card SHALL show the inline "Other" row

#### Scenario: Explicit false
- **WHEN** a `select` prompt carries `allowOther: false`
- **THEN** the card SHALL NOT show the inline "Other" row

#### Scenario: Similar words do not suppress
- **WHEN** a `select` prompt with `allowOther: true` has options `["Others will decide", "Otherwise skip", "Other1"]`
- **THEN** the card SHALL show the inline "Other" row

#### Scenario: Caller already offers an Other option
- **WHEN** a `select` prompt with `allowOther: true` has options `["Approve", "Reject", "Other (describe)"]`
- **THEN** the card SHALL NOT show the inline "Other" row
- **AND** `"Other (describe)"` SHALL render and respond as a normal option

#### Scenario: Question dialog follows the same rules
- **WHEN** a pending `select` question with `allowOther: true` is opened in the question dialog
- **THEN** the dialog SHALL show the inline "Other" row

#### Scenario: No options means no Other
- **WHEN** a `select` prompt carries `allowOther: true` and an empty options list
- **THEN** no inline "Other" row SHALL be shown

### Requirement: Custom answers render as plain text
A custom answer SHALL be displayed as literal text — never interpreted as Markdown or HTML — in the pending card, the batch Review page, and the resolved view. The resolved view of a `select` prompt whose value is not one of its options SHALL show an extra picked row labelled "Other" with the custom text. The resolved view of a `multiselect` prompt SHALL show each value that is not a listed option as an extra picked "Other" row, and its count SHALL read `N of M`, where N is the number of picked values (listed and custom) and M is the number of listed options.

#### Scenario: Markup in custom text is inert
- **WHEN** a custom answer is `"<b>x</b> **y**"`
- **THEN** the card SHALL display exactly `<b>x</b> **y**` as text, without bold formatting or HTML elements

#### Scenario: Resolved select shows the custom answer
- **WHEN** a `select` prompt with options `["A", "B"]` resolved with value `"C"`
- **THEN** the resolved view SHALL show `A` and `B` unpicked and a picked "Other" row reading `C`

#### Scenario: Resolved multiselect counts the custom value
- **WHEN** a `multiselect` prompt with options `["A", "B", "C"]` resolved with values `["A", "D"]`
- **THEN** the resolved view SHALL show `A` picked, a picked "Other" row reading `D`, and the count `2 of 3`
