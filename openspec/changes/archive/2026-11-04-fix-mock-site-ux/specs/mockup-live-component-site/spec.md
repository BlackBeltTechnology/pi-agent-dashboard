## MODIFIED Requirements

### Requirement: Frames render real components
Each frame SHALL render its `current` and `proposed` React nodes inside the
project's real CSS and `Providers`. A frame without `current` SHALL label its only
pane `New`. A frame with `phone: true` SHALL render each side in an iframe whose
content viewport is exactly 375px wide and renders only that pane, so the app's
`@media` rules apply; the iframe height SHALL follow its content. Until the
iframe reports its first height, it SHALL show a loading line at the last height
seen for that pane in this browser session, else 240px. A frame MAY carry a
one-line `why`; it SHALL render under the frame title, and a `why` over 120
characters SHALL show a `WHY > 120` badge.

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

### Requirement: Numbered rings
The kit SHALL export `Issue` (red) and `Fix` (green) rings taking `n`, `tip`, and
optional `block`. The number badge SHALL be a child of the ring at its top-left
corner, moving with it on scroll without script and rendering beneath the sticky
top bar. The tip SHALL show on hover or focus above all content and close on
scroll. A tip over 40 characters SHALL show a `TIP > 40` badge. A ring SHALL NOT
wrap the items it encloses onto new lines, and in a phone pane the badge SHALL sit
above the ring rather than over the ringed content.

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

## ADDED Requirements

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
