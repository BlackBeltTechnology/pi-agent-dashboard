## ADDED Requirements

### Requirement: Mobile layout is bounded to the viewport

In the mobile layout, the application root SHALL bound its total height to the
visible viewport and SHALL NOT allow the document itself to scroll. Any in-flow
banner rendered above the mobile shell (connection status, plugin staleness, or
similar) SHALL consume height from within that bound, and the mobile shell SHALL
flex to occupy exactly the remaining space.

Consequently, showing or hiding an in-flow banner SHALL change only the shell's
available height; it SHALL NOT make the document scrollable, and it SHALL NOT
push the shell's header, progress indicator, or composer out of the viewport.

Viewport-anchored overlays (toasts, modals, and full-screen dialogs) SHALL be
positioned outside the document flow so that they contribute no height to this
bound.

#### Scenario: Banner visible does not make the document scrollable
- **GIVEN** the dashboard is rendered in the mobile layout
- **WHEN** an in-flow banner (e.g. connection status or plugin staleness) is displayed above the shell
- **THEN** the document's scrollable height SHALL NOT exceed the viewport height
- **AND** the shell SHALL shrink by the banner's height rather than overflowing

#### Scenario: Entering a session keeps the shell in the viewport
- **GIVEN** the mobile layout is showing an in-flow banner
- **WHEN** the user opens a session or focuses the message composer
- **THEN** the document SHALL NOT scroll
- **AND** the shell's header and progress indicator SHALL remain fully visible at the top of the viewport

#### Scenario: Banner dismissal reclaims the space
- **GIVEN** the mobile layout is showing an in-flow banner
- **WHEN** the banner is dismissed or its condition clears
- **THEN** the shell SHALL grow to fill the reclaimed height
- **AND** the document SHALL remain non-scrollable

#### Scenario: Overlays add no height
- **WHEN** a toast, first-launch modal, or full-screen dialog is displayed in the mobile layout
- **THEN** it SHALL be viewport-anchored outside the document flow
- **AND** the document's scrollable height SHALL remain equal to the viewport height
