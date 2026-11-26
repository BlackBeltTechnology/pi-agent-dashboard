## MODIFIED Requirements

### Requirement: Frames render real components
Each frame SHALL render its `current` and `proposed` nodes, mounted through the
project's component-framework adapter, inside the project's real CSS and `Providers`.
A frame without `current` SHALL label its only pane `New`. A frame with `phone: true`
SHALL render each side in an iframe whose content viewport is exactly 375px wide and
renders only that pane, so the app's `@media` rules apply. A pane iframe's height SHALL
follow its content, except for a scripted pane, whose height follows the "Scripted panes
are pre-measured fixed stages" requirement of `mockup-site-scripted-interaction`. Until the iframe
reports its first height (for a scripted pane, its measured stage), it SHALL show a loading line at the last height seen for that
pane in this browser session, else 240px. A frame MAY carry a one-line `why`; it SHALL
render under the frame title, and a `why` over 120 characters SHALL show a
`WHY > 120` badge.

#### Scenario: Desktop frame
- **WHEN** a frame has `current`, `proposed`, `width: 1040`
- **THEN** two panes labelled `Current` and `Proposed` render side by side at 1040px each

#### Scenario: Phone frame
- **WHEN** a frame without a script has `phone: true`
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

## ADDED Requirements

### Requirement: A pane never scrolls the reviewer's page
In an embedded pane, `focus()`, `scrollIntoView()` and `scrollIntoViewIfNeeded()` called
inside the pane SHALL NOT change the hosting page's scroll position, whether the script
runner or the mocked component calls them. Focus SHALL still land on its target, and the pane's own scroll
containers SHALL still reveal it. A top-level pane document SHALL keep native scrolling.

#### Scenario: Runner click on an off-screen target in a partly visible pane
- **GIVEN** a scripted pane whose top part, including a click target, is above the viewport
- **WHEN** the click step runs
- **THEN** the hosting page's scroll position is unchanged and the target is the pane document's `activeElement`

#### Scenario: Component focuses an element on open
- **GIVEN** a pane whose component calls `scrollIntoView()` and then `focus()` on an element when it opens, and the hosting page is scrolled so that element is off-screen
- **WHEN** the component opens on every loop
- **THEN** the hosting page's scroll position is unchanged and the element is the pane document's `activeElement`

#### Scenario: Inner scroll container still reveals its row
- **GIVEN** a pane whose component has its own scrollable list with an off-screen row
- **WHEN** the component calls `scrollIntoView()` on that row, or moves focus to it
- **THEN** the list's own scroll position changes to reveal the row, and the hosting page's scroll position is unchanged

#### Scenario: Guard runs before app setup
- **GIVEN** a project whose app module, setup or providers call `focus()` while the pane document boots
- **WHEN** an embedded pane loads
- **THEN** the hosting page's scroll position is unchanged

#### Scenario: Top-level pane keeps native scrolling
- **GIVEN** a pane document opened as a top-level page, as the headless video export does
- **WHEN** a step focuses an off-screen element
- **THEN** the pane document scrolls to reveal it
