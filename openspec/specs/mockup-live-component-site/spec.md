# mockup-live-component-site Specification

## Purpose
A generic, English-only mock site that renders a project's real React components
in Current / Proposed frames, marks changed elements with numbered rings, records
page-level accept/reject decisions in git, and makes every part addressable by a
stable reference link.

## Requirements

### Requirement: Mock directory layout and discovery
Each directory `<root>/<id>/` holding `mock.tsx` SHALL be one mock, `<root>` being
`mockups/` or `openspec/changes/<change>/mockups/` (never under
`openspec/changes/archive/`). `<id>` SHALL equal the directory name and match
`^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`. Mocks SHALL list newest first; adding or
removing a mock directory SHALL reload the site. Invalid or duplicate ids SHALL be reported, not listed.

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

### Requirement: Frames render real components
Each frame SHALL render its `current` and `proposed` React nodes inside the
project's real CSS and `Providers`. A frame without `current` SHALL label its only
pane `New`. A frame with `phone: true` SHALL render each side in an iframe whose
content viewport is exactly 375px wide and renders only that pane, so the app's
`@media` rules apply; the iframe height SHALL follow its content.

#### Scenario: Desktop frame
- **WHEN** a frame has `current`, `proposed`, `width: 1040`
- **THEN** two panes labelled `Current` and `Proposed` render side by side at 1040px each

#### Scenario: Phone frame
- **WHEN** a frame has `phone: true`
- **THEN** each side is an iframe whose `window.innerWidth` is 375, whose height equals its content height, and whose layout uses the app's mobile breakpoints

#### Scenario: New part
- **WHEN** a frame omits `current`
- **THEN** a single pane labelled `New` renders

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
scroll. A tip over 40 characters SHALL show a `TIP > 40` badge.

#### Scenario: Scroll
- **WHEN** the page scrolls
- **THEN** every badge keeps its offset to its ring's top-left corner in every rendered frame, and passes under the sticky bar

#### Scenario: Hover tip
- **WHEN** the pointer enters a ring
- **THEN** its tip shows next to the ring, above any app header or dialog, and disappears when the pointer leaves or the page scrolls

#### Scenario: Badge inside a phone pane
- **WHEN** a ring touches the left or top edge of a phone pane
- **THEN** its badge is fully visible inside the iframe

#### Scenario: Long tip
- **WHEN** a ring's tip has 41 characters
- **THEN** the ring shows a `TIP > 40` badge

### Requirement: Page-level accept and reject
Decisions SHALL apply to a whole mock page, never one frame. The sticky bar SHALL
offer `Accept page` / `Reject page` on an open mock and `Reopen` on a decided one.
A decision SHALL be stored in `<mockDir>/decision.json` as
`{ status, by, note?, at }`; reopen SHALL delete it. Only open mocks SHALL list
unless `Show accepted / rejected` is checked. Open tabs SHALL reflect any
`decision.json` change without reload.

#### Scenario: Accept from the UI
- **WHEN** the user clicks `Accept page`
- **THEN** `decision.json` holds `status: "accepted"`, `by: "user"`, an ISO `at`; the page stays shown with its new status and `Reopen` until the user navigates, and the mock is no longer in the default sidebar list

#### Scenario: Malformed decision file
- **WHEN** a mock's `decision.json` is not valid JSON or has an unknown `status`
- **THEN** the mock is treated as open and the site shows a warning naming the file

#### Scenario: Reopen
- **WHEN** the user clicks `Reopen` on a decided mock
- **THEN** `decision.json` is deleted and the mock is listed as open

#### Scenario: Agent decision reaches open tabs
- **WHEN** the agent CLI rejects a mock (creating its `decision.json`) while a tab shows it
- **THEN** the tab shows `rejected by agent` and the note without reload

#### Scenario: Reopen from the CLI reaches open tabs
- **WHEN** the agent CLI reopens a decided mock (deleting its `decision.json`)
- **THEN** every open tab shows the mock as open without reload

### Requirement: Agent decision CLI
The package SHALL ship a `mock-decide` CLI with `list`, `accept <ref> [note]`,
`reject <ref> <note>`, and `reopen <ref>`, writing the same `decision.json` the
UI writes with `by: "agent"`. `<ref>` SHALL accept a mock id, any reference from
the reference grammar, or a full site URL, reduced to its mock id. `reject`
without a note and an unknown id SHALL exit non-zero with a message and write
nothing. The CLI SHALL work without the site running.

#### Scenario: Reject needs a reason
- **WHEN** the agent runs `mock-decide reject 2026-11-03-session-pills`
- **THEN** it exits non-zero and no file is written

#### Scenario: Deep reference accepted
- **WHEN** the agent runs `mock-decide accept "http://localhost:5299/#2026-11-03-session-pills/1/proposed/2"`
- **THEN** the page `2026-11-03-session-pills` is accepted

#### Scenario: Unknown id
- **WHEN** the ref names no discovered mock
- **THEN** the CLI exits non-zero naming the id and writes nothing

### Requirement: Decide endpoint safety
The decide endpoint SHALL write only `decision.json` inside a discovered mock
directory looked up by id, never following a symlink. It SHALL accept writes only
from a loopback client, only via POST with `application/json`, a body of at most
4 KiB, `status` in `accepted|rejected|open`, and a `note` of at most 500
characters. A present `Origin` that is not the site's own SHALL be refused. The
site SHALL bind to `127.0.0.1` unless LAN access is requested.

#### Scenario: Path traversal attempt
- **WHEN** a POST sends `id: "../../etc"`
- **THEN** the response is 400 and no file is written

#### Scenario: Cross-origin post
- **WHEN** a POST carries `Origin: http://evil.example`
- **THEN** the response is 403 and no file is written

#### Scenario: LAN client cannot decide
- **WHEN** the site runs with LAN access and a phone on the LAN posts a decision
- **THEN** the response is 403, no file is written, and the phone's UI shows no Accept/Reject buttons

#### Scenario: Wrong method, type, or size
- **WHEN** a request uses GET, or a non-JSON content type, or a body over 4 KiB
- **THEN** the response is 405, 415, or 413 respectively and no file is written

#### Scenario: Symlinked decision file
- **WHEN** a mock's `decision.json` is a symlink
- **THEN** the write is refused with 400 and the link target is untouched

### Requirement: Reference grammar
Every page, frame, side, and ring SHALL be addressable as `#<id>`,
`#<id>/<frame>`, `#<id>/<frame>/<side>`, `#<id>/<frame>/<side>/<ring>` (`<frame>`
1-based, `<side>` `current|proposed`, `<ring>` the ring's `n`), and each part SHALL
carry DOM id `r-<ref>`.

#### Scenario: Every part has an id
- **WHEN** a mock with one desktop frame and two rings per side renders
- **THEN** the DOM holds `r-<id>/1`, `r-<id>/1/current`, `r-<id>/1/proposed`, and `r-<id>/1/<side>/<n>` for each ring

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
The extension SHALL register `serve_mock_site` taking optional `dir` (project
root, default cwd), `port` (default 5299), `lan`, and `stop`. It SHALL start the
host project's Vite with `<dir>/mockups/mock-site.config.ts`, refuse port 8000,
fail with an actionable message when the config or Vite is missing or the port
is busy, return the local URL (and LAN URL only when `lan` is true), and stop the
server it started when called with `stop: true` and its port.

#### Scenario: Start
- **WHEN** `serve_mock_site{}` runs in a project with `mockups/mock-site.config.ts`
- **THEN** the result contains `http://localhost:5299` and the URL serves the site

#### Scenario: Missing config
- **WHEN** the project has no `mockups/mock-site.config.ts`
- **THEN** the tool returns an error naming the expected path and starts nothing

#### Scenario: Port busy
- **WHEN** port 5299 is already in use by another HTTP server
- **THEN** the tool returns an error naming the port, does not report the other server as the mock site, and leaves it alone

#### Scenario: Installed from a tarball
- **WHEN** the package is installed from its packed tarball into a fresh React + Vite project with one mock
- **THEN** `serve_mock_site` starts and the mock renders with its rings

#### Scenario: Forbidden port
- **WHEN** `port: 8000` is passed
- **THEN** the tool refuses and starts nothing

#### Scenario: Stop
- **WHEN** `serve_mock_site{stop:true, port:5299}` runs after a start
- **THEN** the Vite child exits and the port is free

#### Scenario: Session ends
- **WHEN** the pi session shuts down with a mock site running
- **THEN** the Vite child is terminated
