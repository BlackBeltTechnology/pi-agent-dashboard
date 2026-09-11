## ADDED Requirements

### Requirement: Chat pane SHALL budget its height so no row is clipped

The chat pane renders a scrollable transcript above a stack of fixed furniture
rows (context strip, status bar, composer, and any `content-inline-footer`
plugin contributions). The pane SHALL apportion its height so that the composer
cannot grow at the expense of the rows below it, and so that the transcript is
never reduced to nothing.

The composer SHALL be bounded to a fraction of the pane's height rather than to a
fixed pixel height, and SHALL scroll its own content when it reaches that bound.
The thin furniture rows SHALL NOT be selected to absorb a height deficit, since
they cannot shrink below their content and would instead be cut off by the pane's
clipping boundary.

#### Scenario: Bottom furniture stays fully visible in a short pane

- **WHEN** the chat pane is short enough that its transcript has no spare space to
  give up
- **THEN** every furniture row below the transcript SHALL render at its full height
  and remain entirely visible within the pane
- **AND** no row SHALL be cut off by the pane's bottom edge

#### Scenario: A long draft does not push the bottom rows out of the pane

- **GIVEN** a chat pane whose rows currently all fit
- **WHEN** the user types a draft long enough to grow the composer to its maximum
- **THEN** the composer SHALL stop growing at its bound and scroll its own content
- **AND** the rows below the composer SHALL remain fully visible

#### Scenario: Transcript retains a share of the pane

- **WHEN** the composer is at its maximum size in a short pane
- **THEN** the transcript SHALL retain a non-zero share of the pane's height
- **AND** SHALL NOT be collapsed to zero height

#### Scenario: Mobile stacked split keeps the pane's rows visible

- **GIVEN** a viewport below the mobile breakpoint in `split` mode, where the chat
  pane occupies only part of the stacked content area
- **AND** the chat pane is at least as tall as the sum of its rows' minimum
  heights (the transcript floor plus the fixed furniture below it)
- **WHEN** the chat pane is rendered
- **THEN** the composer and every row below it SHALL remain fully visible within
  the chat pane
- **AND** below that floor sum, where no arrangement can fit every row, the
  clipping SHALL degrade proportionally rather than removing a row outright
