## ADDED Requirements

### Requirement: Route-backed overlay content SHALL be reachable

Every route-backed overlay SHALL present its content as reachable: no part of
the surface may be clipped away with no gesture able to bring it into view, and
no interactive element may be occluded by whichever close control the surface presents.

This is a **layout** contract, distinct from the routing contract. It is stated
separately because it is invisible to the verification the routing contract
uses: jsdom has no layout engine and reports a zero box for every element, and
`toBeVisible()` passes on an element that is rendered but clipped. A surface can
therefore satisfy every routing requirement while presenting an unusable box.

Verification SHALL run in a real browser against every overlay route.

#### Scenario: Overlay content is either bounded or scrollable

- **GIVEN** any route-backed overlay route
- **WHEN** its content exceeds the dialog container's height cap
- **THEN** a descendant of the container SHALL be a working scroller
  (`overflow-y` of `auto`/`scroll` with `scrollHeight > clientHeight`), so the
  overflowing content is reachable

#### Scenario: Content that fits is not clipped

- **GIVEN** any route-backed overlay route
- **WHEN** its content fits within the dialog container's height cap
- **THEN** the container's `scrollHeight` SHALL NOT exceed its `clientHeight`
  beyond a rounding tolerance

#### Scenario: No interactive element is occluded by the close control

- **GIVEN** any route-backed overlay route, and its EFFECTIVE close control —
  the container's built-in ✕ where one is rendered, otherwise the dismissal
  control the surface itself presents
- **WHEN** the overlay is displayed
- **THEN** no OTHER visible interactive element (`button`, `a`, `input`,
  `select`) within the container SHALL have a bounding box intersecting the
  control's bounding box

#### Scenario: The gate covers every overlay route, not a known-bad list

- **WHEN** a new route-backed overlay route is added
- **THEN** it SHALL be covered by the same reachability assertions as the
  existing routes, so a newly converted surface cannot regress silently
