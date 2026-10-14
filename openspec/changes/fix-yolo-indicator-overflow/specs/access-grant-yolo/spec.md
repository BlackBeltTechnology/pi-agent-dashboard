## MODIFIED Requirements

### Requirement: An active YOLO session is unmissable and fully recorded

While YOLO is active, an indicator naming the remaining time SHALL be displayed,
without requiring navigation to a settings surface, on:

- the sidebar header's app-level control row, alongside the other persistent
  app-level indicators, so that it is present on every route where that row is
  visible. It SHALL be compact, SHALL indicate that YOLO is active and the
  remaining time, and SHALL lead to the surface where the session can be ended;
- every session surface whose working directory lies within a root in scope, and
  every session surface when the session is unscoped; and
- the Access settings page, which SHALL additionally name the affected planes,
  the agent path gate, and every root in scope, and SHALL carry the control to
  end the session immediately.

No indicator SHALL be dismissible while YOLO is active.

The description of what YOLO actually covers (agent and dashboard file access)
SHALL be carried by every indicator; it SHALL NOT claim coverage of anything
YOLO does not answer. The sidebar indicator and a session-surface indicator MAY
carry an abbreviated visible label instead of the full description, provided the
full description is carried at that indicator by the indicator's pointer tooltip
AND by its accessible description, so that it is available
without navigating away to an operator hovering with a pointer or using
assistive technology. For an operator using touch, or a keyboard without
assistive technology, a single tap or Enter on the indicator SHALL lead to the
Access settings page, which carries the full description.

The verified set for the layout clauses below is: viewport widths of 375 px,
768 px and 1500 px, each at a viewport height of at least 600 px, with the
interface language set to `en` and to `hu` (the shipped locale with the longest
indicator strings; its rendered label SHALL be at least as wide as the `zh-CN`
label for each indicator), for both a scoped and an unscoped session.

Within the verified set, neither the sidebar indicator nor a session-surface
indicator SHALL wrap its text onto a second line: its height SHALL equal one
line box of its own text plus its vertical padding and border, and it SHALL NOT
extend past its host row's bounds. Where the indicator shares a horizontal row
with other controls — the sidebar header's app-level control row, and the
desktop session header row — that row's height SHALL NOT exceed its height with
no YOLO session active and the same other controls. Where the session header
stacks its parts vertically (the mobile session header), the indicator occupies
its own line, so the header SHALL grow by no more than the indicator's own
single-line height. When the available width is smaller than the indicator's
preferred width but at least the width of the active-YOLO marker plus the
remaining time plus the indicator's horizontal padding and border, the
descriptive part of the label SHALL degrade first (clipped with an ellipsis)
while the active-YOLO marker and the remaining time stay legible. Below that
width the no-overflow clause takes precedence: the indicator SHALL still neither
wrap nor extend past its host row's bounds, the marker and the remaining time
MAY be clipped, and that band is outside the verified set.

These clauses constrain the indicator only: they do not constrain where, or on
which line, other controls sharing the row render, nor how they behave when that
row runs out of width.

Where the remaining time is unbounded because the session was activated by the
environment and never expires, the indicator's time slot SHALL still render a
legible value standing for "does not expire", and the indicator's full
description SHALL state that the session lasts until the server stops.

An indicator whose remaining time counts down — the sidebar indicator and every
session-surface indicator — SHALL NOT carry a live-region role (`status`,
`alert`, `log`, `timer`, `marquee`) or an `aria-live` value other than `off`, and
neither SHALL any of its ancestors. Such an indicator SHALL carry its full
description as an accessible description, not in its accessible name; the
description text, and its pointer tooltip, SHALL be identical before and after
the countdown advances, and the indicator's accessible name SHALL NOT include
that description text.

Where the sidebar header is not visible, the session-surface indicator SHALL
remain the operator's signal; the indicator SHALL NOT be rendered only in the
sidebar.

An unscoped session SHALL be visually distinguished from a scoped one, since the
difference between "this folder" and "this disk" is the entire point of the
choice. That distinction SHALL NOT depend on a symbol already used by these
indicators for another meaning.

Every automatic allow SHALL be recorded with its plane (or the agent path gate)
and subject and SHALL be listed in the Access surface, so the set of paths
reached during a YOLO session is reviewable after it ends. Agent path-gate
auto-allows SHALL count toward the same cumulative auto-allow total reported by
the health endpoint.

#### Scenario: The indicator is always visible

- **GIVEN** YOLO is active
- **WHEN** the dashboard is displayed
- **THEN** the sidebar header SHALL show a compact active-YOLO indicator with the remaining time
- **AND** every session surface within a root in scope SHALL show an indicator with the remaining time
- **AND** the Access page SHALL name the affected planes, the agent path gate, and every root in scope
- **AND** an unscoped session SHALL be distinguishable from a scoped one, and SHALL indicate on every session surface
- **AND** no indicator SHALL be dismissible

#### Scenario: The indicator survives a collapsed sidebar

- **GIVEN** YOLO is active and the sidebar header is not visible
- **WHEN** a session surface within a root in scope is displayed
- **THEN** it SHALL still show that YOLO is active and the remaining time

#### Scenario: An unscoped session does not grow the desktop session header row

- **GIVEN** an unscoped YOLO session is active and the interface language is `en` or `hu`
- **WHEN** a session surface is displayed at a viewport width of 768 px, then 1500 px, with a viewport height of at least 600 px
- **THEN** at each width the session-header indicator's height SHALL equal one line box of its text plus its vertical padding and border
- **AND** the indicator's right edge SHALL NOT exceed its host row's right edge
- **AND** the host row's height SHALL NOT exceed its height when no YOLO session is active at that same width

#### Scenario: The mobile session header grows by exactly one indicator line

- **GIVEN** an unscoped YOLO session is active and the interface language is `en` or `hu`
- **WHEN** a session surface is displayed at a viewport width of 375 px with a viewport height of at least 600 px
- **THEN** the session-header indicator's height SHALL equal one line box of its text plus its vertical padding and border
- **AND** the indicator's right edge SHALL NOT exceed the header's right edge
- **AND** the header's height SHALL NOT exceed its height when no YOLO session is active plus the indicator's height

#### Scenario: An unscoped session does not grow the sidebar control row

- **GIVEN** an unscoped YOLO session is active and the interface language is `en` or `hu`
- **WHEN** the sidebar header's app-level control row is displayed at a viewport width of 375 px (sidebar drawer opened), 768 px and 1500 px
- **THEN** at each width the active-YOLO indicator's height SHALL equal one line box of its text plus its vertical padding and border
- **AND** the indicator's right edge SHALL NOT exceed the row's right edge
- **AND** the row's height SHALL NOT exceed its height when no YOLO session is active at that same width

#### Scenario: A width too small for the label keeps the marker and the time

- **GIVEN** an active YOLO session
- **WHEN** an indicator is rendered in a row narrower than its preferred width but at least as wide as its marker plus its remaining time plus its horizontal padding and border
- **THEN** the descriptive part of the label SHALL be clipped with an ellipsis
- **AND** the active-YOLO marker and the remaining time SHALL remain fully legible
- **AND** the indicator SHALL neither wrap nor extend past the row's bounds

#### Scenario: The abbreviated label still explains the coverage

- **GIVEN** an active YOLO session whose indicator shows an abbreviated label
- **WHEN** the operator hovers the indicator with a pointer, or reaches it while using assistive technology
- **THEN** the full description — agent and dashboard file access, and whether every folder is covered — SHALL be available at that indicator, without navigating away, as its pointer tooltip and as its accessible description
- **AND** the indicator SHALL still lead to the surface where the session can be ended

#### Scenario: A touch or keyboard operator without assistive technology can still obtain the coverage

- **GIVEN** an active YOLO session whose indicator shows an abbreviated label
- **WHEN** an operator without assistive technology taps the indicator, or reaches it by keyboard and presses Enter
- **THEN** the Access settings page SHALL be shown
- **AND** it SHALL name the affected planes, the agent path gate and every root in scope

#### Scenario: A session that never expires still shows a legible time slot

- **GIVEN** an active YOLO session activated by the environment, which does not expire
- **WHEN** an indicator for that session is displayed
- **THEN** its time slot SHALL render a legible value standing for "does not expire"
- **AND** its full description SHALL state that the session lasts until the server stops
- **AND** the indicator SHALL still occupy a single line

#### Scenario: The countdown does not re-announce every tick

- **GIVEN** an active YOLO session with a sidebar indicator and a session-surface indicator whose remaining time advances once per second
- **WHEN** the remaining time advances by one second
- **THEN** for each of the two indicators, neither the indicator nor any of its ancestors SHALL carry a live-region role or an `aria-live` value other than `off`
- **AND** each indicator's accessible description and pointer tooltip SHALL be identical before and after the tick
- **AND** neither indicator's accessible name SHALL contain its accessible description text

#### Scenario: Auto-allows are reviewable afterwards

- **GIVEN** a YOLO session auto-allowed several subjects, including agent tool calls
- **WHEN** the session has ended
- **THEN** the Access surface SHALL list what was auto-allowed, distinguished from operator-answered verdicts
- **AND** agent path-gate entries SHALL be labelled as such

#### Scenario: Every auto-allow is logged

- **WHEN** a denial or an agent path-gate prompt is auto-allowed
- **THEN** it SHALL be recorded with the plane (or agent path gate), the subject, and the fact that no human answered
- **AND** the health endpoint's cumulative auto-allow count SHALL increase by one
