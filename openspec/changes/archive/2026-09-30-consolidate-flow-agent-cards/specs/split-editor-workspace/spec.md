## ADDED Requirements

### Requirement: A deliberate re-open of the same editor target re-applies it

The editor route bridge SHALL apply a route target once per **open intent**, not
once per URL. An open intent is the target (session id, `file`, `line`, `url`)
plus a nonce the opener mints fresh for that open. A route open carrying a fresh
nonce SHALL re-apply even when the target is unchanged, so a target the user has
closed — with the pane's close control, or by closing only its file tab — can be
re-opened by the same control that opened it. A re-render that changes only the
openers' identity while the nonce is unchanged SHALL NOT re-apply; that is what
lets the user close the split while the URL still names the target. The intent
SHALL be carried outside the URL: the route string SHALL remain the shareable
deep link a copied URL produces, and no per-open value SHALL be required in it.

#### Scenario: The pane close control does not block a re-open

- **GIVEN** a flow card's file control opened a file in the split editor
- **AND** the user closed the editor with its close control, leaving the route at
  the editor route for that file
- **WHEN** the user activates the same card's file control again
- **THEN** the split SHALL re-open with that file as the active editor tab

#### Scenario: Closing a file's tab does not block a re-open

- **GIVEN** the split editor is open and a file opened from a card's file control
  is one of its tabs
- **WHEN** the user closes that file's tab, leaving the pane open
- **AND** the user activates the same card's file control again
- **THEN** the file's tab SHALL re-open and SHALL become the active tab

#### Scenario: Closing the pane does not re-open it by itself

- **GIVEN** the split editor is open from a route target
- **WHEN** the user closes the editor with its close control and the mode change
  recreates the openers
- **THEN** no re-render of the route bridge SHALL re-open the split
- **AND** the split SHALL stay closed until a fresh open intent arrives

## MODIFIED Requirements

### Requirement: Chat pane SHALL budget its height so no row is clipped

The chat pane renders a scrollable transcript among a stack of furniture rows
(sticky header slot, session banner, context strip, status bar, queue panel,
composer, and any `content-inline-footer` plugin contributions). The pane SHALL
apportion its height so that the composer cannot grow at the expense of the rows
below it, and so that the transcript is never reduced to nothing.

Every row of the pane SHALL be classified, explicitly and in one place, as either
**shrinkable** or **fixed**:

- A row is shrinkable only if it owns a scrollport, so that reducing its height
  hides content behind a scrollbar rather than outside its box. Each shrinkable
  row SHALL declare a shrink weight and a lower bound.
- Every other row is fixed. A fixed row SHALL hold its content height and SHALL
  NOT be shrunk, because a row that neither clips nor scrolls would paint its
  content over its neighbour rather than hide it.

The `content-header-sticky` row SHALL be classified **shrinkable**, because it
owns a scrollport: a height deficit hides its lower content behind its own
scrollbar instead of painting that content outside the row's box and over the
neighbouring editor pane. It SHALL declare a floor, a bound strictly below that
floor, and a weight, and it SHALL take its share of a pane deficit together with
the other shrinkable rows rather than being counted as a fixed row. Its bound
SHALL be 0: the wrapper is rendered for every selected session while its
contribution may be empty (no flow attached, or a collapsed flow panel), so a
non-zero bound would pad an empty slot into a dead band, and the row's own
`overflow-y-auto` already makes its automatic minimum 0, so the row can be given
all the way down to nothing. When the pane gives the row at least its content
height it SHALL render at that height with no scrollbar; when the pane gives it
less, the row SHALL render at its allocated height and scroll internally, keeping
every control inside it reachable.

Rows that render conditionally (session banner, queue panel, plugin slot
contributions, the transcript's error-boundary fallback) are classified the same
way and are part of the pane's budget whenever they are present, so the floor sum
— the declared transcript floor, plus the composer's base height, plus the content
heights of the fixed rows currently rendered — is a function of pane state rather
than a constant.

The pane SHALL declare the transcript floor explicitly rather than inheriting an
emergent one. Each shrinkable row's declared floor SHALL be greater than its lower
bound, so that the row has height to give; a row whose floor equals its bound
cannot participate in the allocation at all.

Every row SHALL render at its own content height exactly when the pane covers the
sum of all rows' base heights — the content heights of the fixed rows currently
rendered, plus the base heights of the shrinkable rows currently rendered. Below
that sum the pane SHALL share the deficit across the shrinkable rows by applying
each row's declared weight to its own base height, so a shrinkable row whose base
height is 0 receives no share and the pane's geometry is unchanged by its
presence. No fixed row SHALL be selected to absorb a height deficit.

Below the floor sum the pane SHALL distribute the deficit across the shrinkable
rows by applying each row's declared weight to its own base height, and SHALL NOT
let one shrinkable row absorb the whole deficit while another is still above its
lower bound. A shrinkable row's share SHALL be determined by its own weight and
base height, and SHALL NOT depend on its position among its siblings.

Only once every shrinkable row has reached its lower bound MAY the residual
shortfall be clipped by the pane's boundary. That the residual is then taken from
the bottom-most row is a declared consequence of the pane's clipping boundary, not
an allocation: the contract's guarantee is that no row is asked to give before the
scrollable rows have given everything.

The composer SHALL be bounded to a fraction of the pane's height rather than to a
fixed pixel height, and SHALL scroll its own content when it reaches that bound.

#### Scenario: Bottom furniture stays fully visible in a short pane

- **GIVEN** a pane at least as tall as the floor sum
- **WHEN** the chat pane is short enough that its transcript has no spare space to
  give up
- **THEN** every furniture row below the transcript SHALL render at its full height
  and remain entirely visible within the pane
- **AND** no row SHALL be cut off by the pane's bottom edge

#### Scenario: Below the floor sum the deficit is shared by the shrinkable rows

- **GIVEN** a pane shorter than the floor sum but taller than the sum of the
  shrinkable rows' lower bounds and the fixed rows' content heights
- **WHEN** the chat pane is rendered
- **THEN** every shrinkable row with a non-zero base height SHALL be shorter than
  its base height
- **AND** a shrinkable row whose base height is 0 (an empty `content-header-sticky`
  slot) SHALL render at 0px, having no share of the deficit to give
- **AND** no shrinkable row SHALL absorb the entire deficit while another is still
  above its lower bound
- **AND** every fixed row SHALL still render at its content height
- **AND** no row's content SHALL be painted outside that row's own box

#### Scenario: Deficit allocation grows continuously with the shortfall

- **GIVEN** a pane shrinking from the floor sum downward
- **WHEN** the pane height decreases step by step
- **THEN** each shrinkable row's height SHALL decrease monotonically with the
  shortfall
- **AND** no row SHALL be removed or hidden in one step
- **AND** the transcript SHALL retain a non-zero height at every step, so its
  virtualized viewport is never measured at zero

#### Scenario: A shrinkable row at its lower bound stops absorbing

- **GIVEN** a pane far enough below the floor sum that one shrinkable row has
  reached its declared lower bound
- **WHEN** the pane shrinks further
- **THEN** that row SHALL hold at its lower bound
- **AND** the additional deficit SHALL be taken from the shrinkable rows still
  above their lower bounds
- **AND** the fixed rows SHALL remain at their content heights until every
  shrinkable row is at its bound

#### Scenario: Residual shortfall is clipped only as a last resort

- **GIVEN** a pane shorter than every row can collectively accommodate
- **WHEN** every shrinkable row has reached its lower bound
- **THEN** the residual shortfall MAY be clipped by the pane's boundary
- **AND** this SHALL NOT occur at any pane height where a shrinkable row is still
  above its lower bound

#### Scenario: A long draft does not push the bottom rows out of the pane

- **GIVEN** a chat pane whose rows currently all fit
- **WHEN** the user types a draft long enough to grow the composer to its maximum
- **THEN** the composer SHALL stop growing at its bound and scroll its own content
- **AND** the rows below the composer SHALL remain fully visible

#### Scenario: Transcript retains a share of the pane

- **GIVEN** a pane at least as tall as the floor sum
- **WHEN** the composer is at its maximum size in a short pane
- **THEN** the transcript SHALL retain a non-zero share of the pane's height
- **AND** SHALL NOT be collapsed to zero height

#### Scenario: A conditional row raises the floor sum while it is rendered

- **GIVEN** a pane rendering a conditional row (session banner, queue panel, or a
  plugin slot contribution)
- **WHEN** the pane sits at a height that was at or above the floor sum without
  that row
- **THEN** the conditional row SHALL count toward the floor sum while it is
  rendered
- **AND** the deficit it introduces SHALL be taken from the shrinkable rows before
  any row is clipped

#### Scenario: Mobile stacked split keeps the pane's rows visible

- **GIVEN** a viewport below the mobile breakpoint in `split` mode, where the chat
  pane occupies only part of the stacked content area
- **AND** the chat pane is at least as tall as the floor sum
- **WHEN** the chat pane is rendered
- **THEN** the composer and every row below it SHALL remain fully visible within
  the chat pane
- **AND** when the user drags the split divider to its minimum ratio, which on a
  small phone puts the pane below the floor sum, the shortfall SHALL be taken from
  the shrinkable rows rather than clipped off the bottom-most row

#### Scenario: Sticky header row is capped to the pane and scrolls internally

- **GIVEN** a chat pane 243px tall whose `content-header-sticky` contribution (the flow card panel) is 476px tall
- **WHEN** the pane is rendered
- **THEN** the header row SHALL render at its allocated height — its share of the pane's deficit, derived from its declared weight and its own 476px base height — and no taller
- **AND** the pane's other rows SHALL each take their own share of the deficit rather than being clipped on the header's behalf
- **AND** the row's overflowing content SHALL be reachable through the row's own vertical scrollbar
- **AND** no part of the row SHALL paint outside its own box

#### Scenario: Flow card buttons receive clicks while the split editor is open

- **GIVEN** the split editor is open and the chat pane is 243px tall while the flow card panel in the sticky header row is 476px tall
- **WHEN** the user scrolls the header row to a card's "Open handler in editor" control and clicks it
- **THEN** that control SHALL receive the click
- **AND** it SHALL NOT be reported as covered by the editor pane
- **AND** opening a file from one card SHALL NOT make another card's control unclickable

#### Scenario: A tall pane renders the header row at its content height

- **GIVEN** a chat pane at least as tall as the sum of all rows' base heights, with the flow panel rendered
- **WHEN** the header row's content fits in the pane
- **THEN** the row SHALL render at its content height
- **AND** the row SHALL expose no scrollbar

#### Scenario: An empty header slot does not consume pane height

- **GIVEN** a selected session whose `content-header-sticky` slot has no contribution (no flow attached, so the slot renders nothing), or a collapsed flow panel
- **WHEN** the chat pane is rendered at any height
- **THEN** the header row SHALL render at 0px
- **AND** the header row SHALL NOT hold a pixel floor
- **AND** the pane's other rows SHALL receive the same heights they receive with no header row rendered at all
