## Purpose

Provide a read/write API and UI affordance for the per-line checkboxes in an OpenSpec change's `tasks.md`, so dashboard users can monitor and toggle task completion without leaving the session card. The server is the single source of truth for the parsed task list; the session-card Tasks popover and its button label both derive their counts from the same parser to prevent silent disagreement between surfaces.

## Requirements

### Requirement: Server parses tasks.md into structured task list
The dashboard server SHALL expose `GET /api/openspec/tasks?cwd=<abs>&change=<name>` returning a JSON array of parsed tasks read from `<cwd>/openspec/changes/<name>/tasks.md`. Each task SHALL include `id`, `text`, `done`, `line` (1-indexed line number in the source file), and `group` (the nearest preceding `## ` heading).

The parser SHALL accept top-level checkbox lines (`^- \[[ xX]\] `) with or without a numeric `1.1`-style id prefix. When the source line has no numeric id, the parser SHALL synthesize `id = "L<line>"` where `<line>` is the 1-indexed line number — a stable, opaque token that round-trips through the toggle endpoint without leaking into the file. Indented checkbox lines (leading whitespace before `-`) SHALL continue to be ignored.

#### Scenario: Parses unticked and ticked tasks with numeric ids
- **WHEN** `tasks.md` contains `- [ ] 1.1 Create module` on line 3 and `- [x] 1.2 Add dep` on line 4 under `## 1. Setup` (line 1)
- **THEN** the response SHALL include `{id:"1.1", text:"Create module", done:false, line:3, group:"1. Setup"}` and `{id:"1.2", text:"Add dep", done:true, line:4, group:"1. Setup"}`

#### Scenario: Parses id-less checkboxes with synthesized line-number ids
- **WHEN** `tasks.md` contains `- [ ] Verify runner image` on line 5 and `- [x] Add matrix row` on line 6 under `## 1. Workflow matrix` (line 3)
- **THEN** the response SHALL include `{id:"L5", text:"Verify runner image", done:false, line:5, group:"1. Workflow matrix"}` and `{id:"L6", text:"Add matrix row", done:true, line:6, group:"1. Workflow matrix"}`

#### Scenario: Parses files mixing id-ed and id-less checkboxes
- **WHEN** `tasks.md` contains `- [ ] 1.1 Foo` on line 3 and `- [x] Bar` on line 4
- **THEN** the response SHALL include both, with `id:"1.1"` for the first and `id:"L4"` for the second

#### Scenario: Unparseable lines omitted
- **WHEN** `tasks.md` contains a line `- foo bar` (no checkbox) mixed with valid tasks
- **THEN** the response SHALL include only the valid tasks and SHALL NOT fail the request

#### Scenario: Indented checkboxes ignored
- **WHEN** `tasks.md` contains `  - [ ] indented sub-task` on line 5 (note leading whitespace)
- **THEN** the response SHALL NOT include that line, regardless of whether it carries a numeric id

#### Scenario: Change directory missing
- **WHEN** `<cwd>/openspec/changes/<name>/tasks.md` does not exist
- **THEN** the server SHALL respond with HTTP 404 and body `{ success: false, error: "tasks.md not found" }`

#### Scenario: Localhost guard enforced
- **WHEN** the request originates from a non-loopback address and is not authenticated
- **THEN** the server SHALL respond with HTTP 403, identical to the behaviour of the existing `GET /api/openspec` route

### Requirement: Server toggles a single checkbox in tasks.md
The dashboard server SHALL expose `POST /api/openspec/tasks/toggle` accepting `{ cwd: string, change: string, id: string, done: boolean, line: number }`. The server SHALL rewrite the target line in `tasks.md` to flip the `[ ]` or `[x]` marker, preserving all other file content byte-for-byte AND preserving the source line shape (a line that had no numeric id MUST NOT acquire one; a line that had a numeric id MUST retain it).

The id-validation step SHALL accept either a numeric id (when the source line has one) or the synthesized `L<line>` form (when the source line has no numeric id), but never both. Mismatched id forms SHALL be treated as line-mismatches.

#### Scenario: Tick an unticked id-ed task
- **WHEN** the request body is `{cwd, change, id:"8.3", done:true, line:47}` and line 47 of `tasks.md` reads `- [ ] 8.3 Manual smoke: …`
- **THEN** line 47 SHALL be rewritten to `- [x] 8.3 Manual smoke: …` and the server SHALL respond HTTP 200 with the updated `OpenSpecTask` record

#### Scenario: Tick an unticked id-less task
- **WHEN** the request body is `{cwd, change, id:"L12", done:true, line:12}` and line 12 of `tasks.md` reads `- [ ] Verify runner image`
- **THEN** line 12 SHALL be rewritten to `- [x] Verify runner image` (no synthetic id text inserted) and the server SHALL respond HTTP 200 with `{id:"L12", text:"Verify runner image", done:true, line:12, group:…}`

#### Scenario: Wrong id form returns 409
- **WHEN** the request body sends `id:"L12"` against a line that has a numeric id (`- [ ] 1.1 Foo` on line 12), or sends `id:"1.1"` against a line that has no numeric id
- **THEN** the server SHALL respond HTTP 409 with `{ success: false, error: "line mismatch" }` and SHALL NOT modify the file

#### Scenario: Line mismatch returns 409
- **WHEN** the request's `line` value no longer matches the file (e.g. the file was edited between `GET` and `POST`)
- **THEN** the server SHALL respond HTTP 409 with `{ success: false, error: "line mismatch" }` and SHALL NOT modify the file

#### Scenario: Toggle triggers an openspec refresh broadcast
- **WHEN** a toggle succeeds for change `<name>` in `<cwd>`
- **THEN** the server SHALL enqueue an immediate openspec re-poll for `<cwd>` and broadcast a fresh `openspec_update` message to subscribed browsers

#### Scenario: Malformed target line rejected
- **WHEN** the request's `line` points to a line that does not match the parser's accepted checkbox shape
- **THEN** the server SHALL respond HTTP 400 with `{ success: false, error: "target line is not a checkbox" }`

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
