## ADDED Requirements

### Requirement: Selection callbacks invoke the current onDraftChange prop
The `CommandInput` component SHALL invoke the latest `onDraftChange` prop
reference when the user selects an autocomplete suggestion, regardless of how
many prop updates have occurred since the component mounted. This requirement
applies to all three selection entry points: **Tab key**, **Enter key** (when
the dropdown is open and non-empty), and **mouse click** on a dropdown item.
It applies to both the `/` command dropdown and the `@` file dropdown.

#### Scenario: Tab selects command after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with a different `onDraftChange=v2` (simulating a session
  switch in the parent), then the user types `/dep` and presses **Tab**
- **THEN** the component SHALL call `v2("/deploy ")` — NOT `v1` — and the
  dropdown SHALL close

#### Scenario: Enter selects command after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with `onDraftChange=v2`, then the user types `/dep` and
  presses **Enter**
- **THEN** the component SHALL call `v2("/deploy ")` — NOT `v1` — and the
  dropdown SHALL close

#### Scenario: Mouse click selects command after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with `onDraftChange=v2`, then the user types `/dep` and
  clicks the `/deploy` dropdown row
- **THEN** the component SHALL call `v2("/deploy ")` — NOT `v1`

#### Scenario: Tab selects file after onDraftChange reference changes
- **WHEN** `CommandInput` is rendered with `draft=""` and `onDraftChange=v1`,
  then re-rendered with `onDraftChange=v2`, then the user types `@` (and
  `fileResults` is populated), then presses **Tab**
- **THEN** the component SHALL call `v2` with a draft string that contains
  the selected file path — NOT `v1`
