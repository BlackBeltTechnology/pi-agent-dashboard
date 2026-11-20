## MODIFIED Requirements

### Requirement: Inline Other enablement and suppression
The inline "Other" row SHALL be opt-in. It SHALL be shown on a `select` or `multiselect` prompt (or a batch `select`/`multiselect` sub-question) only when it carries `allowOther: true` and lists at least one option. Every other prompt SHALL render exactly as before. `confirm`, `input` and `editor` prompts SHALL never show it. The dashboard and the server SHALL decide enablement with one shared definition, so a surface shows the row exactly when the REST answer road accepts a custom answer: on the inline chat card, the grouped free-floating panel and the pending-question dialog.

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
- **AND** all three options SHALL render as normal options

#### Scenario: Caller already offers an Other option
- **WHEN** a `select` prompt with `allowOther: true` has options `["Approve", "Reject", "Other (describe)"]`
- **THEN** the card SHALL show the inline "Other" row
- **AND** `"Other (describe)"` SHALL NOT render as a separate option

#### Scenario: Question dialog follows the same rules
- **WHEN** a pending `select` question with `allowOther: true` is opened in the question dialog
- **THEN** the dialog SHALL show the inline "Other" row

#### Scenario: No options means no Other
- **WHEN** a `select` prompt carries `allowOther: true` and an empty options list
- **THEN** no inline "Other" row SHALL be shown

## ADDED Requirements

### Requirement: Caller's own Other option collapses into the inline row
When the inline Other answer is enabled and a listed option is an "Other" option, that option SHALL NOT render as its own button or checkbox; the inline row stands in and its typed text is the answer. The match is the one in `hasOwnOtherOption` (trimmed text is the word "Other" alone or before a non-letter/non-digit, case-insensitive, English-only). The literal option SHALL stay an accepted REST answer.

#### Scenario: Own Other hidden, typed text answers
- **WHEN** an opted-in `select` lists `["Approve", "Other (describe)"]` and the user activates the inline "Other" and submits `"later"`
- **THEN** the response SHALL be `{ value: "later" }` and no second `input` prompt SHALL be required

#### Scenario: Multiselect own Other hidden
- **WHEN** an opted-in `multiselect` lists `["A", "Other: specify"]`
- **THEN** only `"A"` SHALL render as a listed checkbox, plus the inline "Other" row

#### Scenario: Non-opted-in prompt keeps its own Other
- **WHEN** a `select` with no `allowOther` lists `["Approve", "Other (describe)"]`
- **THEN** `"Other (describe)"` SHALL render and respond as a normal option and no inline row SHALL show

#### Scenario: REST accepts the literal and custom text
- **WHEN** an opted-in prompt lists `"Other (describe)"` and a client posts that literal string, or any trimmed non-empty text
- **THEN** the answer road SHALL accept both
