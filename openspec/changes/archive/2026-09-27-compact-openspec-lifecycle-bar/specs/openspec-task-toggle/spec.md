## MODIFIED Requirements

### Requirement: Session card renders a Tasks popover button
When a session has an attached proposal and the attached change has at least one parseable task, the session card's lifecycle bar SHALL render its `Tasks` segment as a button labelled `<ticked>/<total>`, with accessible name "Tasks <ticked> of <total> done". Activating it SHALL open a popover listing every task grouped by heading, each with a native checkbox. The segment SHALL be inert while the session is `streaming`, because the popover can toggle checkboxes. There SHALL be no separate Tasks button in the header or action row.

The segment label's `<total>` and `<ticked>` counters SHALL agree with the number of rows the popover would render for the same file. The dashboard SHALL NOT render a label like "24/36" while the popover body says "No tasks." — these two surfaces share a single source of truth (the parser defined above).

#### Scenario: Tasks button shows counts
- **WHEN** the attached change's `tasks.md` has 30 ticked and 33 total parseable tasks (id-ed, id-less, or any mix)
- **THEN** the lifecycle bar's `Tasks` segment SHALL be labelled `30/33` with accessible name "Tasks 30 of 33 done"

#### Scenario: Button count matches popover row count
- **WHEN** the `Tasks` segment label says `24/36` for the attached change
- **THEN** activating the segment SHALL open a popover containing exactly 36 rows, of which 24 are ticked

#### Scenario: Clicking opens popover with grouped tasks
- **WHEN** the user activates the `Tasks` segment on an idle session
- **THEN** a popover SHALL open listing tasks grouped by heading, with unticked tasks visually distinguishable from ticked ones

#### Scenario: Toggling a checkbox calls the toggle endpoint
- **WHEN** the user clicks an unticked task checkbox in the popover
- **THEN** the client SHALL POST `/api/openspec/tasks/toggle` with `done:true` and update the row optimistically; on error, the row SHALL revert and surface the error text

#### Scenario: 409 refetches and retains popover
- **WHEN** the toggle endpoint responds HTTP 409 (line mismatch)
- **THEN** the client SHALL refetch `/api/openspec/tasks`, re-render the popover with fresh data, and display a short "File changed — please try again" banner

#### Scenario: No tasks hides the button
- **WHEN** the attached change's `tasks.md` contains zero parseable tasks (or the file is absent)
- **THEN** the `Tasks` segment SHALL render `Tasks —` and be inert, and no other Tasks control SHALL render
