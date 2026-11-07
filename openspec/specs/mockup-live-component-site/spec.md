# mockup-live-component-site Specification

## Purpose
A generic, English-only mock site that renders a project's real components in
Current / Proposed frames, marks changed elements with numbered rings, shows the
page-level decisions the agent records in git with the decide CLI (read-only in the
site), and makes every part addressable by a stable reference link.

## Requirements

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

### Requirement: Pane styling and containment
Each pane SHALL style app components with the project's real stylesheet,
including Tailwind utilities used only in app sources or only in mock files, and
SHALL contain its content's layout and painting so app parts cannot escape it.

#### Scenario: App and mock utility classes are generated
- **WHEN** a Tailwind class is used only in an app component source, and another only in a `mock.tsx`
- **THEN** both classes have computed styles in the rendered pane

#### Scenario: Fixed-position app part stays in its pane
- **WHEN** a pane renders a non-portaled app component with `position: fixed` and a high `z-index`
- **THEN** it is positioned and clipped within its pane and does not cover the sticky top bar

### Requirement: Numbered rings
The kit SHALL export `Issue` (red) and `Fix` (green) rings taking `n`, `tip`, and
optional `block`. The number badge SHALL be a child of the ring at its top-left
corner, moving with it on scroll without script and rendering beneath the sticky
top bar. The tip SHALL show on hover or focus above all content and close on
scroll. A tip over 40 characters SHALL show a `TIP > 40` badge. A ring SHALL NOT
wrap the items it encloses onto new lines, and in a phone pane the badge SHALL sit
above the ring rather than over the ringed content.
The top bar SHALL carry a `Highlights` switch (default on, persisted in
`localStorage` key `mk-rings`) that hides every ring's outline, badge and tip in the
shell and in every isolated pane without a reload; rings keep their layout and DOM
ids so references still resolve.

#### Scenario: Scroll
- **WHEN** the page scrolls
- **THEN** every badge keeps its offset to its ring's top-left corner in every rendered frame, and passes under the sticky bar

#### Scenario: Hover tip
- **WHEN** the pointer enters a ring
- **THEN** its tip shows next to the ring, above any app header or dialog, and disappears when the pointer leaves or the page scrolls

#### Scenario: Badge inside a phone pane
- **WHEN** a ring touches the left or top edge of a phone pane
- **THEN** its badge is fully visible inside the iframe

#### Scenario: Badge does not cover ringed text in a phone pane
- **WHEN** a ring encloses a text pill in a phone pane
- **THEN** the badge's box does not overlap the ring's box

#### Scenario: Long tip
- **WHEN** a ring's tip has 41 characters
- **THEN** the ring shows a `TIP > 40` badge

#### Scenario: Highlights switched off
- **WHEN** the user unchecks `Highlights` in the top bar
- **THEN** no ring outline, badge or tip is visible in the shell or in any phone iframe, no pane reloads, and the choice survives a page reload

### Requirement: Page-level accept and reject
Decisions SHALL apply to a whole mock page, never one frame. The site SHALL show a
page's decision status read-only (open, `accepted by <by>`, `rejected by <by>` with the
note) and SHALL offer no control that writes a decision. A decision SHALL be stored in
`<mockDir>/decision.json` as `{ status, by, note?, at }` and written only by the
agent decision CLI; reopen SHALL delete it. Only open mocks SHALL list unless
`Show accepted / rejected` is checked. Open tabs SHALL reflect any `decision.json`
change without reload.

#### Scenario: Agent records the user's approval
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

### Requirement: Reference links and deep-link navigation
Page title, frame number and title, side label, and ring badge SHALL be links to
their reference. Activating one SHALL copy the full URL and navigate the
top-level page, also from inside a phone iframe. Opening a reference SHALL scroll
to the deepest existing part (ring, else side, else frame) and briefly highlight
it; a page reference SHALL scroll to the top.

#### Scenario: Deep link to a ring
- **WHEN** the site opens at `#2026-11-03-session-pills/1/proposed/2`
- **THEN** ring 2 of frame 1's Proposed pane is scrolled into view and highlighted

#### Scenario: Ring inside a phone iframe
- **WHEN** the user clicks a ring badge inside a phone frame
- **THEN** the top page hash becomes that ring's reference, the top page scrolls to that ring, and the ring is highlighted

#### Scenario: Deep link to a ring inside a phone frame
- **WHEN** the site opens at a reference to a ring inside a phone frame
- **THEN** the top page scrolls so that ring is in view and the ring is highlighted

#### Scenario: Copy link
- **WHEN** the user clicks a frame's `#ref`
- **THEN** the clipboard holds the full site URL ending in that reference

### Requirement: Themes follow the project's default
The site SHALL read an ordered theme list from the project config, default to
the first entry, persist the choice, and apply it to every pane including phone
iframes. A `system` entry SHALL resolve dark or light from
`prefers-color-scheme` and SHALL re-apply when the OS preference changes. The
top bar SHALL use the same background colour as the page body under every theme.

#### Scenario: System default
- **WHEN** a browser with light colour scheme opens the site for the first time and the first theme is `system`
- **THEN** the light theme applies and `System` shows as selected

#### Scenario: OS switches
- **WHEN** the OS switches to dark while `System` is selected
- **THEN** the site and all phone iframes switch to dark without reload

#### Scenario: Top bar matches page
- **WHEN** the app's own stylesheet sets a `body` background
- **THEN** the computed background of `body` and of the sticky bar are equal

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

### Requirement: Frame steps show state changes without interaction
A frame MAY declare `steps` (each with a `label` and a `proposed` node) instead of
`current`/`proposed`. By default the steps SHALL render side by side in order,
each step labelled `<frame><letter> <label>` (`2a`, `2b`, …) and addressable as
`<id>/<frame>/proposed/step-<k>`. The kit SHALL export `Tap`, which marks the
element whose click leads to the next step. A frame declaring both `steps` and
`current`/`proposed` SHALL be reported as a problem and render its steps.

#### Scenario: Steps side by side
- **WHEN** a frame has three `steps` and no `play`
- **THEN** three step cards labelled `<n>a`, `<n>b`, `<n>c` render in order, each with a ref id `<id>/<n>/proposed/step-1` … `step-3`

#### Scenario: Deep link to a step
- **WHEN** the site opens at `#<id>/<n>/proposed/step-2`
- **THEN** step 2 scrolls into view and is highlighted

#### Scenario: Steps with panes
- **WHEN** a frame has both `steps` and `current`
- **THEN** the problems list names the mock and frame, and the steps render

### Requirement: Animated frame steps
A `steps` frame with `play: true` SHALL render its steps in one pane that
advances automatically, with a pause control and one control per step. When the
user prefers reduced motion the steps SHALL render side by side instead.

#### Scenario: Animated steps
- **WHEN** a frame has `steps` and `play: true`
- **THEN** one pane shows one step at a time and advances to the next step without input, and a pause control stops it

#### Scenario: Reduced motion
- **WHEN** a frame has `play: true` and the browser prefers reduced motion
- **THEN** the steps render side by side

### Requirement: Mock page overview and empty state
Each mock page SHALL begin with an overview listing one card per frame (frame
number, title, `why`, and whether it has Current / Proposed / steps) that links to
`#<id>/<frame>`. Current / Proposed pane labels SHALL render as neutral and green
chips. When the project has no mocks at all, the site SHALL show "No mocks yet"
with the expected `mockups/<yyyy-mm-dd-slug>/mock.tsx` path.

#### Scenario: Overview card links to its frame
- **WHEN** a mock with two frames is opened
- **THEN** two overview cards render, and activating the second opens `#<id>/2`

#### Scenario: No mocks
- **WHEN** no mock directory exists under any mock root
- **THEN** the site shows "No mocks yet" and the path pattern instead of "Nothing open"

### Requirement: Example mock ships outside the mock roots
The package's example mock SHALL live under `packages/mockup-loop/examples/`,
which is not a mock root, so a project's mock site never lists it by default.

#### Scenario: Fresh checkout
- **WHEN** the dashboard repository's mock site starts on a clean checkout
- **THEN** it does not list `2026-11-03-session-pills`
