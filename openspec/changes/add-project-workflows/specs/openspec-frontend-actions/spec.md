## ADDED Requirements

### Requirement: OpenSpec action bars render project workflow actions

The session-card and composer OpenSpec action bars SHALL render the actions a
project workflow offers for the attached change (see `project-workflows`)
alongside the built-in actions. When a workflow offers an enabled action, it
SHALL take the primary slot; the built-in candidate for the change state SHALL
move to the overflow menu. Disabled workflow actions SHALL render inert with
their reason, like a blocked built-in action. Workflow actions SHALL use the
label and icon declared in the workflow file, falling back to a generic icon.

#### Scenario: Workflow action becomes primary

- **GIVEN** an attached change in state PLANNING and a workflow offering enabled action "Plan proposal"
- **WHEN** the session card renders
- **THEN** "Plan proposal" SHALL be the primary button
- **AND** "Continue" SHALL be in the overflow menu

#### Scenario: No workflow

- **WHEN** the project has no workflow files
- **THEN** the bars SHALL render exactly as before

### Requirement: Projects can hide built-in OpenSpec actions

A workflow's `builtins` map SHALL control each built-in action key
(`continue`, `ff`, `apply`, `verify`, `archive`, `archiveAnyway`, `explore`,
`new`, `propose`) with `keep` (default), `hide`, or `hideWhen: <gate>`. A hidden
built-in SHALL not render in the primary slot or the overflow menu. `detach`
SHALL NOT be hideable. When several workflows disagree, `hide` SHALL win.

#### Scenario: Apply hidden on develop

- **GIVEN** `builtins: { apply: { hideWhen: onDevelop } }`
- **WHEN** a READY change is rendered in a develop session
- **THEN** no Apply button SHALL render
- **AND** in a worktree session Apply SHALL render as before
