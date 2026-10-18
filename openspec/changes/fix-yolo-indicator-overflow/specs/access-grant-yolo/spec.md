## MODIFIED Requirements

### Requirement: An active YOLO session is unmissable and fully recorded

While YOLO is active, the dashboard SHALL signal it, without requiring
navigation to a settings surface, on:

- the sidebar header's app-level control row, which SHALL be visibly tinted for
  as long as YOLO is active, on every route where that row is visible. The tint
  SHALL NOT add a visible control to the row, SHALL NOT change the row's height
  (with or without keyboard focus inside the row), and SHALL NOT name the
  remaining time. The row SHALL carry the full description as its pointer
  tooltip (controls in the row that have their own tooltip keep it); SHALL contain, as its first focusable element, a link to the surface
  where the session can be ended, visually hidden until it receives keyboard
  focus, whose accessible name is the full description. The row itself SHALL
  NOT navigate on click;
- every dashboard prompt composer — on a session surface or on a folder home —
  whose working directory lies within a root in scope, and every such composer
  when the session is unscoped, by a strip placed directly above the composer
  that names the remaining time and shows the full description as visible text
  inside a link to the surface where the session can be ended; the remaining
  time SHALL NOT be part of that link's accessible name; and
- the Access settings page, which SHALL additionally name the affected planes,
  the agent path gate, and every root in scope, and SHALL carry the control to
  end the session immediately.

The session header SHALL NOT carry a YOLO indicator. Session surfaces without
a prompt composer (an archived session opened read-only) carry no in-content
YOLO signal; the sidebar row and the Access page remain.

No signal SHALL be dismissible while YOLO is active.

The description of what YOLO actually covers (agent and dashboard file access)
SHALL be carried by every signal; it SHALL NOT claim coverage of anything YOLO
does not answer. The composer strip MAY clip its visible description with an
ellipsis when width runs out, provided its link's pointer tooltip carries the
full description and the full description remains its link's accessible name. For
an operator using touch, or a keyboard without assistive technology, a single
tap on the strip's description, or Enter on the strip's link or on the sidebar
row's link, SHALL
lead to the Access settings page, which carries the full description.

The verified set for the layout clauses below is: viewport widths of 375 px,
768 px and 1500 px, each at a viewport height of at least 600 px, with the
interface language set to `en` and to `hu` (the shipped locale with the longest
strings; its rendered strip description SHALL be at least as wide as the
`zh-CN` one), for both a scoped and an unscoped session.

Within the verified set the composer strip SHALL NOT wrap its text onto a
second line: its height SHALL equal one line box of its own text plus its
vertical padding and border, and it SHALL NOT extend past the composer
column's bounds. The sidebar header's app-level row SHALL have the same height
with YOLO active as with no YOLO session active. When the strip's available
width is smaller than its preferred width but at least the width of its
active-YOLO marker plus the remaining time plus its horizontal padding and
border, the description SHALL degrade first (clipped with an ellipsis) while
the marker and the remaining time stay legible. Below that width the
no-overflow clause takes precedence: the strip SHALL still neither wrap nor
extend past the column's bounds, the marker and the remaining time MAY be
clipped, and that band is outside the verified set.

These clauses constrain the YOLO signals only: they do not constrain where, or
on which line, other controls sharing a row render, nor how they behave when
that row runs out of width.

Where the remaining time is unbounded because the session was activated by the
environment and never expires, the strip SHALL render a legible value standing
for "does not expire" in its time slot, with an equivalent text alternative for
assistive technology, and the full description SHALL state that the session
lasts until the server stops.

No YOLO signal, and none of its ancestors, SHALL carry a live-region role
(`status`, `alert`, `log`, `timer`, `marquee`) or an `aria-live` value other
than `off`. The full description, every pointer tooltip and the sidebar row
link's accessible name SHALL be identical before and after the countdown
advances, and so SHALL the composer strip link's accessible name.

Where the sidebar header is not visible, the composer strip SHALL remain the
operator's signal on every prompt composer in scope; YOLO SHALL NOT be
signalled only in the sidebar.

An unscoped session SHALL be visually distinguished from a scoped one on the
composer strip, since the difference between "this folder" and "this disk" is
the entire point of the choice. That distinction SHALL NOT depend on a symbol
already used by these signals for another meaning.

Every automatic allow SHALL be recorded with its plane (or the agent path gate)
and subject and SHALL be listed in the Access surface, so the set of paths
reached during a YOLO session is reviewable after it ends. Agent path-gate
auto-allows SHALL count toward the same cumulative auto-allow total reported by
the health endpoint.

#### Scenario: The indicator is always visible

- **GIVEN** YOLO is active
- **WHEN** the dashboard is displayed
- **THEN** the sidebar header's app-level row SHALL be tinted and SHALL contain no additional visible control
- **AND** every dashboard prompt composer within a root in scope SHALL show a strip with the full description and the remaining time
- **AND** the session header SHALL show no YOLO indicator
- **AND** the Access page SHALL name the affected planes, the agent path gate, and every root in scope
- **AND** an unscoped session SHALL be distinguishable from a scoped one on the strip
- **AND** no signal SHALL be dismissible

#### Scenario: The indicator survives a collapsed sidebar

- **GIVEN** YOLO is active and the sidebar header is not visible
- **WHEN** a session surface with a prompt composer within a root in scope is displayed
- **THEN** its composer strip SHALL still show that YOLO is active and the remaining time

#### Scenario: The sidebar tint explains itself and leads to Access

- **GIVEN** YOLO is active
- **WHEN** the operator hovers the sidebar header's app-level row outside any control that has its own tooltip
- **THEN** the pointer tooltip SHALL be the full description
- **WHEN** the operator moves keyboard focus into the row
- **THEN** the first focus stop SHALL be a now-visible link whose accessible name is the full description, the row's height SHALL be unchanged, and Enter SHALL open the Access settings page
- **WHEN** the operator clicks the row anywhere outside that link
- **THEN** the click SHALL behave exactly as with no YOLO session active

#### Scenario: The sidebar tint does not change row 1's height

- **GIVEN** a scoped or unscoped YOLO session is active and the interface language is `en` or `hu`
- **WHEN** the sidebar header's app-level row is displayed at a viewport width of 375 px (sidebar drawer opened), 768 px and 1500 px
- **THEN** at each width the row's height SHALL equal its height when no YOLO session is active

#### Scenario: The composer strip stays on one line

- **GIVEN** a scoped or an unscoped YOLO session is active and the interface language is `en` or `hu`
- **WHEN** a session surface with a prompt composer, and a folder home with a prompt composer, both within a root in scope, are displayed at 375 px, 768 px and 1500 px with a viewport height of at least 600 px
- **THEN** at each width the strip's height SHALL equal one line box of its text plus its vertical padding and border
- **AND** the strip's right edge SHALL NOT exceed the composer column's right edge
- **AND** the remaining time SHALL be fully legible

#### Scenario: A width too small for the description keeps the marker and the time

- **GIVEN** an active YOLO session
- **WHEN** the composer strip is rendered narrower than its preferred width but at least as wide as its marker plus its remaining time plus its horizontal padding and border
- **THEN** the description SHALL be clipped with an ellipsis
- **AND** the active-YOLO marker and the remaining time SHALL remain fully legible
- **AND** the strip SHALL neither wrap nor extend past the column's bounds

#### Scenario: The full description is available everywhere

- **GIVEN** an active YOLO session
- **WHEN** the operator hovers the sidebar row (outside controls with their own tooltip) or the composer strip, or reaches the sidebar row's link or the strip while using assistive technology
- **THEN** the full description — agent and dashboard file access, and whether every folder is covered — SHALL be available without navigating away

#### Scenario: A touch or keyboard operator without assistive technology can still obtain the coverage

- **GIVEN** an active YOLO session
- **WHEN** an operator without assistive technology taps the composer strip's description, or presses Enter on the strip's link or on the sidebar row's focused link
- **THEN** the Access settings page SHALL be shown
- **AND** it SHALL name the affected planes, the agent path gate and every root in scope

#### Scenario: A session that never expires still shows a legible time slot

- **GIVEN** an active YOLO session activated by the environment, which does not expire
- **WHEN** the composer strip is displayed
- **THEN** its time slot SHALL render a legible value standing for "does not expire", with a text alternative for assistive technology
- **AND** the full description SHALL state that the session lasts until the server stops
- **AND** the strip SHALL still occupy a single line

#### Scenario: The countdown does not re-announce every tick

- **GIVEN** an active YOLO session whose remaining time advances once per second
- **WHEN** the remaining time advances by one second
- **THEN** neither the sidebar row, its link, the composer strip, nor any of their ancestors SHALL carry a live-region role or an `aria-live` value other than `off`
- **AND** every pointer tooltip, the sidebar row link's accessible name and the composer strip link's accessible name SHALL be identical before and after the tick
- **AND** the composer strip link's accessible name SHALL NOT contain the remaining time

#### Scenario: Auto-allows are reviewable afterwards

- **GIVEN** a YOLO session auto-allowed several subjects, including agent tool calls
- **WHEN** the session has ended
- **THEN** the Access surface SHALL list what was auto-allowed, distinguished from operator-answered verdicts
- **AND** agent path-gate entries SHALL be labelled as such

#### Scenario: Every auto-allow is logged

- **WHEN** a denial or an agent path-gate prompt is auto-allowed
- **THEN** it SHALL be recorded with the plane (or agent path gate), the subject, and the fact that no human answered
- **AND** the health endpoint's cumulative auto-allow count SHALL increase by one
