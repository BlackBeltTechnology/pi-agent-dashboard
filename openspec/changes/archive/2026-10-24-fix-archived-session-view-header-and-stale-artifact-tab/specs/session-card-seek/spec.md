## MODIFIED Requirements

### Requirement: Seek control reveals the active session's card

The `SessionHeader` SHALL present an icon-only "Reveal in sidebar" button for an open session, next to the session title. The button SHALL use the `mdiDockLeft` icon, carry `aria-label` and `title` "Reveal in sidebar", and keep `data-testid="session-header-seek-card"`. The title menu SHALL also offer a "Reveal in sidebar" item. Both entry points SHALL trigger the same reveal.
The session header renders above the ChatView body (ChatView itself has no
header). Activating either entry point SHALL reveal that session's card in the sidebar
`SessionList` by expanding every collapsed fold-ancestor, selecting the card,
scrolling it to center, and applying a transient flash highlight.

The reveal SHALL be triggerable repeatedly for the same session (each activation
re-fires, even when the session is already selected).

The read-only archived view (`/session/<id>?archived=1`) has no live sidebar card, so the header SHALL NOT render the Reveal in sidebar control (button or title-menu item) for it.

The Reveal in sidebar control SHALL be presented on desktop only. When the viewport is in the
mobile layout (the sidebar is a separate overlay), the control SHALL NOT be
rendered.

#### Scenario: Seek control is hidden in the mobile layout

- **WHEN** an open session is rendered in the mobile layout
- **THEN** no Reveal in sidebar control SHALL appear in the session header

#### Scenario: Reveal a card buried under a collapsed workspace, folder, and ended group

- **WHEN** the active session is `ended`, lives in a folder whose workspace tier
  is collapsed, whose folder group is collapsed, and whose ended sub-group is
  collapsed
- **AND** the user activates the Reveal in sidebar control in the session header
- **THEN** the workspace tier SHALL expand
- **AND** the folder group SHALL expand
- **AND** the ended sub-group SHALL expand
- **AND** the session's card SHALL be selected, scrolled into view, and flashed

#### Scenario: Re-seeking an already-selected session re-fires the reveal

- **WHEN** the active session's card is already selected but has since been
  re-collapsed under a fold-ancestor
- **AND** the user activates the Reveal in sidebar control again
- **THEN** the fold-ancestors SHALL expand and the card SHALL scroll into view
  again

#### Scenario: No reveal control in the read-only archived view

- **WHEN** an archived session is opened read-only via `/session/<id>?archived=1`
- **THEN** neither the Reveal in sidebar button nor its title-menu item SHALL appear in the session header
