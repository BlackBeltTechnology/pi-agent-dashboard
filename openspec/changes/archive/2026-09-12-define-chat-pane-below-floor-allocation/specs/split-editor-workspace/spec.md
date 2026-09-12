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

At and above the floor sum every row SHALL render at full height, and no fixed row
SHALL be selected to absorb a height deficit.

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
- **THEN** every shrinkable row SHALL be shorter than its base height
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
