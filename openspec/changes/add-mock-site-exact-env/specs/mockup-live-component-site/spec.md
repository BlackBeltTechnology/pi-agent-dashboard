## MODIFIED Requirements

### Requirement: Mock directory layout and discovery
Each directory `<root>/<id>/` holding `mock.tsx` SHALL be one mock, `<root>` being
`mockups/` or `openspec/changes/<change>/mockups/` (never under
`openspec/changes/archive/`, and never under a dependency directory such as
`node_modules/`). `<id>` SHALL equal the directory name and match
`^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`. Mocks SHALL list newest first; adding or
removing a mock directory SHALL reload the site, and editing a mock file SHALL
update the open page without a restart. Invalid or duplicate ids SHALL be reported,
not listed.

#### Scenario: Mock in root mockups
- **WHEN** `mockups/2026-11-03-session-pills/mock.tsx` exists
- **THEN** the sidebar lists it under its category and `#2026-11-03-session-pills` opens it

#### Scenario: Mock adopted into a change
- **WHEN** the mock directory is moved to `openspec/changes/<name>/mockups/2026-11-03-session-pills/`
- **THEN** the site still lists it with the same id and decision

#### Scenario: Archived change excluded
- **WHEN** a mock exists only under `openspec/changes/archive/<date>-<name>/mockups/`
- **THEN** the site does not list it

#### Scenario: Invalid id or duplicate
- **WHEN** a directory name does not match the id pattern, or two roots hold the same id
- **THEN** the site shows an error naming the offending path(s) and does not list the invalid/duplicate entry

#### Scenario: Dependency directory excluded
- **WHEN** a directory matching the mock layout exists under `node_modules/`
- **THEN** the site does not list it

### Requirement: Frames render real components
Each frame SHALL render its `current` and `proposed` nodes, mounted through the
project's component-framework adapter, inside the project's real CSS and `Providers`.
A frame without `current` SHALL label its only pane `New`. A frame with `phone: true`
SHALL render each side in an iframe whose content viewport is exactly 375px wide and
renders only that pane, so the app's `@media` rules apply; the iframe height SHALL
follow its content. Until the iframe reports its first height, it SHALL show a loading
line at the last height seen for that pane in this browser session, else 240px. A
frame MAY carry a one-line `why`; it SHALL render under the frame title, and a `why`
over 120 characters SHALL show a `WHY > 120` badge.

#### Scenario: Desktop frame
- **WHEN** a frame has `current`, `proposed`, `width: 1040`
- **THEN** two panes labelled `Current` and `Proposed` render side by side at 1040px each

#### Scenario: Phone frame
- **WHEN** a frame has `phone: true`
- **THEN** each side is an iframe whose `window.innerWidth` is 375, whose height equals its content height, and whose layout uses the app's mobile breakpoints

#### Scenario: Phone frame before its first height
- **WHEN** a phone pane is first shown and its iframe has not reported a height
- **THEN** the pane is at least 240px tall and shows a loading line, which disappears when the height arrives

#### Scenario: New part
- **WHEN** a frame omits `current`
- **THEN** a single pane labelled `New` renders

#### Scenario: Frame reason
- **WHEN** a frame has `why: "Missing folder wins"`
- **THEN** that text renders under the frame title and in the page overview

### Requirement: Reference grammar
Every page, frame, side, ring and step SHALL be addressable as `#<id>`,
`#<id>/<frame>`, `#<id>/<frame>/<side>`, `#<id>/<frame>/<side>/<ring>`, and
`#<id>/<frame>/<side>/step-<k>`. Here `<frame>` is 1-based, `<side>` is
`current|proposed`, `<ring>` is the ring's `n`, and `<k>` is a 1-based step. Each part
SHALL carry DOM id `r-<ref>`. A ring `n` starting with `step-` SHALL be reported like an
invalid `n`, so ring and step references never collide.

#### Scenario: Every part has an id
- **WHEN** a mock with one desktop frame and two rings per side renders
- **THEN** the DOM holds `r-<id>/1`, `r-<id>/1/current`, `r-<id>/1/proposed`, and `r-<id>/1/<side>/<n>` for each ring

#### Scenario: Step reference parses as a step
- **WHEN** `#<id>/1/proposed/step-3` is parsed
- **THEN** it resolves to step 3 of the proposed side of frame 1, not to a ring

#### Scenario: Ring named like a step
- **WHEN** a mock declares a ring with `n="step-1"`
- **THEN** the ring shows the invalid-`n` badge

### Requirement: Page-level accept and reject
Decisions SHALL apply to a whole mock page, never one frame. The site SHALL show a
page's decision status read-only (open, `accepted by <by>`, `rejected by <by>` with the
note) and SHALL offer no control that writes a decision. A decision SHALL be stored in
`<mockDir>/decision.json` as `{ status, by, note?, at }` and written only by the
agent decision CLI; reopen SHALL delete it. Only open mocks SHALL list unless
`Show accepted / rejected` is checked. Open tabs SHALL reflect any `decision.json`
change without reload.

#### Scenario: Accept from the UI
- **WHEN** the user approves a mock page in conversation
- **THEN** the agent records it with `mock-decide accept`; the page shows `accepted by agent` read-only and the mock is no longer in the default sidebar list

#### Scenario: Reopen
- **WHEN** the agent runs `mock-decide reopen` on a decided mock
- **THEN** `decision.json` is deleted and the mock is listed as open

#### Scenario: No decision controls in the site
- **WHEN** any mock page is shown, open or decided, on loopback or LAN
- **THEN** the page offers no Accept, Reject or Reopen control and sends no decision write

#### Scenario: Malformed decision file
- **WHEN** a mock's `decision.json` is not valid JSON or has an unknown `status`
- **THEN** the mock is treated as open and the site shows a warning naming the file

#### Scenario: Agent decision reaches open tabs
- **WHEN** the agent CLI rejects a mock (creating its `decision.json`) while a tab shows it
- **THEN** the tab shows `rejected by agent` and the note without reload

#### Scenario: Reopen from the CLI reaches open tabs
- **WHEN** the agent CLI reopens a decided mock (deleting its `decision.json`)
- **THEN** every open tab shows the mock as open without reload

#### Scenario: Legacy user decision still read
- **WHEN** a mock's `decision.json` was written earlier by the removed UI with `by: "user"`
- **THEN** the site shows `accepted by user` (or rejected) read-only and adoption honours it

### Requirement: Agent decision CLI
The package SHALL ship a `mock-decide` CLI with `list`, `accept <ref> [note]`,
`reject <ref> <note>`, and `reopen <ref>`, the only writers of `decision.json`, writing
`by: "agent"`. Its adoption helpers SHALL never write `decision.json`. It SHALL write
only `decision.json` inside a discovered mock directory looked up by id, and SHALL
never follow a symlink. `<ref>` SHALL accept a mock id, any reference from the
reference grammar, or a full site URL, reduced to its mock id. Each of these SHALL
exit non-zero with a one-line message and write nothing:
- `reject` without a note
- a note over 500 characters
- an unknown id
- a refused write

The CLI SHALL work without the site running.

#### Scenario: Reject needs a reason
- **WHEN** the agent runs `mock-decide reject 2026-11-03-session-pills`
- **THEN** it exits non-zero and no file is written

#### Scenario: Deep reference accepted
- **WHEN** the agent runs `mock-decide accept "http://localhost:5299/#2026-11-03-session-pills/1/proposed/2"`
- **THEN** the page `2026-11-03-session-pills` is accepted

#### Scenario: Unknown id
- **WHEN** the ref names no discovered mock
- **THEN** the CLI exits non-zero naming the id and writes nothing

#### Scenario: Symlinked decision file
- **WHEN** a mock's `decision.json` is a symlink
- **THEN** the CLI exits non-zero with a one-line message and the link target is untouched

#### Scenario: Note too long
- **WHEN** the agent runs `mock-decide accept <ref>` with a 501-character note
- **THEN** it exits non-zero and no file is written

### Requirement: Serve tool
The extension SHALL register `serve_mock_site` taking optional `dir` (project root,
default cwd), `port` (default 5299), `lan`, and `stop`. It SHALL start the mock site
through the project's own launcher with the inherited build shape (see
`mockup-site-environment`), applying the project's mock options when present. It
SHALL refuse port 8000. It SHALL fail with an
actionable message when the build tool or framework has no adapter, the build tool is
missing, or the port is busy. It SHALL return the local URL (and the LAN URL only when
`lan` is true) and stop the server it started when called with `stop: true` and its
port. Its description and result text SHALL tell the agent to show the URL to the user
and to record decisions with the decide CLI.

#### Scenario: Start
- **WHEN** `serve_mock_site{}` runs in a project with a supported build tool
- **THEN** the result contains `http://localhost:5299` and the URL serves the site

#### Scenario: Missing config
- **WHEN** the project has no mock options file
- **THEN** the site starts with the inherited build shape and default themes

#### Scenario: Port busy
- **WHEN** port 5299 is already in use by another HTTP server
- **THEN** the tool returns an error naming the port, does not report the other server as the mock site, and leaves it alone

#### Scenario: Installed from a tarball
- **WHEN** the package is installed from its packed tarball into a fresh project with a supported build tool and framework and one mock
- **THEN** `serve_mock_site` starts and the mock renders with its rings

#### Scenario: Forbidden port
- **WHEN** `port: 8000` is passed
- **THEN** the tool refuses and starts nothing

#### Scenario: Stop
- **WHEN** `serve_mock_site{stop:true, port:5299}` runs after a start
- **THEN** the server child exits and the port is free

#### Scenario: Session ends
- **WHEN** the pi session shuts down with a mock site running
- **THEN** the server child is terminated

## REMOVED Requirements

### Requirement: Decide endpoint safety
**Reason**: The site no longer writes decisions, so the browser decide endpoint is removed. Its file-safety rules (lookup by id, no symlink following, note length) live in the `Agent decision CLI` requirement.
**Migration**: Record decisions with `mock-decide accept|reject|reopen <ref>`. Existing `decision.json` files stay valid and are still read.
