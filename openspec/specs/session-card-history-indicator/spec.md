# session-card-history-indicator Specification

## Purpose
Show, on each session card in the sidebar, whether that session's chat history
is loading, waiting for the connection, or failed to load, via a ring around the
card's status chip, without changing the card's layout.

## Requirements

### Requirement: Session card shows a history-load ring

The session card SHALL render a ring around its status chip that reflects the
session's history load phase:

| Phase | Ring |
|---|---|
| never loaded, or loaded | none |
| waiting (selected, no chat content, connection not established) | static dashed ring |
| loading (connected; flag set, before or after first content, until the terminal batch) | animated partial arc in the accent colour |
| failed (connected; history load marked failed, no chat content) | static solid ring in the error colour |

When more than one row matches, the first matching row in the order waiting,
loading, failed SHALL apply. The ring SHALL be rendered in every card layout
(desktop and mobile).

The three visible rings SHALL differ in shape (partial arc, dashed, solid), not
only in colour. Every ring SHALL meet a 3:1 contrast ratio against the card
background in every theme palette, light and dark. The ring SHALL NOT change the card's
layout (no reflow of the name, timestamp, or actions) and SHALL NOT paint over
the status chip's status-shape badge.

#### Scenario: Unopened card shows no ring

- **GIVEN** a session that has never been subscribed in this tab
- **WHEN** its card renders
- **THEN** no ring SHALL be rendered and the card SHALL look as it does today.

#### Scenario: Loading card shows the animated arc

- **GIVEN** the dashboard is connected
- **AND** a session whose loading or replay-in-flight flag has been set for longer than the show-delay
- **WHEN** its card renders
- **THEN** the card SHALL render the animated accent arc around the status chip.

#### Scenario: Ring persists through streaming and clears on completion

- **GIVEN** a card showing the loading arc
- **WHEN** the first content batch arrives but the terminal batch has not
- **THEN** the arc SHALL remain
- **AND** WHEN the terminal batch arrives THEN the arc SHALL be removed.

#### Scenario: Waiting card shows the dashed ring

- **GIVEN** the selected session has no chat content
- **WHEN** the connection is not established
- **THEN** its card SHALL render the static dashed ring, even if its loading flag or failed mark is set.

#### Scenario: Disconnected session with content shows no waiting ring

- **GIVEN** the selected session already shows messages and no replay is in flight
- **WHEN** the connection drops
- **THEN** its card SHALL NOT render the dashed ring.

#### Scenario: Failed card shows the solid error ring

- **GIVEN** a session whose history load is marked failed and has no chat content
- **AND** the dashboard is connected
- **WHEN** its card renders
- **THEN** its card SHALL render the static solid error-coloured ring.

#### Scenario: Ring does not shift the card layout

- **GIVEN** a card rendered with no ring
- **WHEN** the ring appears or disappears
- **THEN** the bounding boxes of the card, its name, and its timestamp SHALL be unchanged.

### Requirement: Card ring is suppressed for fast loads

The loading arc SHALL NOT paint until the loading phase has persisted for the
same show-delay used by the chat view's replay-in-flight indicator. A load that
completes within the delay SHALL never paint the arc. The waiting and failed
rings SHALL paint immediately.

#### Scenario: Fast load never paints the arc

- **GIVEN** a session whose history finishes loading within the show-delay
- **WHEN** the load completes
- **THEN** its card SHALL never have rendered the loading arc.

### Requirement: Card ring state is available as text

The status chip SHALL expose the ring state as text: the chip's tooltip SHALL
keep its existing source/status text and append the ring state ("Loading
history…", "Still loading history · Ns" after 10 s, "Waiting for connection",
"Couldn't load history"), and visually-hidden text SHALL name the state for
assistive technology. The tooltip's elapsed seconds SHALL update at least once
per second while the card is loading. Only the selected session's card SHALL
expose its ring state as a live status message, and that message SHALL NOT
include the updating seconds; other cards SHALL NOT announce, so many cards
cannot flood a screen reader.

#### Scenario: Tooltip names the loading state

- **GIVEN** a card showing the loading arc
- **WHEN** the user hovers the status chip
- **THEN** the tooltip SHALL include "Loading history…"
- **AND** the tooltip SHALL still include the session's source and status.

#### Scenario: Only the selected card announces

- **GIVEN** two cards in the loading phase, one selected
- **WHEN** assistive technology observes live regions
- **THEN** only the selected card SHALL expose a status message.

### Requirement: Card ring honours reduced motion

When the user prefers reduced motion, or the dashboard's hidden-window /
offscreen animation pause is active, the loading arc SHALL stop animating while
remaining a partial arc, so it stays distinguishable from the dashed and solid
rings. Like every indeterminate progress indicator in the dashboard, the arc
SHALL keep animating under the visible-but-idle animation pause.

#### Scenario: Reduced motion stops the spin

- **GIVEN** the user prefers reduced motion
- **WHEN** a card shows the loading arc
- **THEN** the arc SHALL render static and still as a partial arc.
