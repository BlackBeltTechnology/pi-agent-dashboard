## MODIFIED Requirements

### Requirement: Concurrently-pending free-floating asks render as one grouped panel

The client SHALL render the set of pending **free-floating** asks inside a
single grouped multi-ask panel. An ask is free-floating when it carries no
`toolCallId` AND is not owned by a widget-bar slot. The panel SHALL be a
vertical stack of independently-answerable cards (one per pending ask), reusing
the existing per-type renderers (confirm / select / input / multiselect).

Placement categories SHALL be evaluated in precedence order, so that an ask
matching more than one is placed by the first that applies:

1. **Widget-bar owned.** An ask whose prompt component is of a widget-bar
   registered type SHALL render in that slot only and SHALL NOT be pulled into
   the panel — **regardless of whether it also carries a `toolCallId`** — so it
   is never rendered twice. Widget-bar ownership SHALL be determined by the
   prompt component's registered type; the protocol's producer-declared
   `placement` field is currently NOT consulted, so this requirement constrains
   the client shell only and cannot bind a plugin that renders its own slot off
   a claim the registry does not know about.
2. **Tool-paired.** An ask that carries a `toolCallId` and is not widget-bar
   owned SHALL keep its inline placement paired with its tool row and SHALL NOT
   be pulled into the panel.
3. **Free-floating.** Every other pending ask belongs in the panel.

The panel SHALL render whenever **one or more** free-floating asks are pending;
a single pending free-floating ask renders as a one-card panel rather than
inline. An ask with `method:"batch"` **that belongs to the panel** SHALL render
as its atomic BatchRenderer wizard, occupying one slot in the stack; a
tool-paired batch ask renders inline like any other tool-paired ask.

Placement SHALL be stable with respect to the pending set: an ask arriving,
resolving, or being cancelled SHALL NOT change the placement of any other
pending ask. This forbids any grouping rule that moves a card between the panel
and the inline stream as the number of pending asks changes, because such a
move remounts the card and discards in-progress input.

#### Scenario: Two free-floating confirms group into one panel
- **GIVEN** two pending free-floating confirms `p1` and `p2`
- **THEN** a single grouped panel SHALL render containing two answerable cards
- **AND** each card SHALL answer its own `requestId` independently
- **AND** neither SHALL also render inline in the message stream

#### Scenario: A tool-paired ask stays inline
- **GIVEN** a pending ask `p3` whose `interactiveUi` row carries a `toolCallId`
- **AND** a pending free-floating ask `p1`
- **THEN** `p3` SHALL render inline next to its tool row
- **AND** only `p1` SHALL appear in the grouped panel

#### Scenario: Late arrival appends; resolution removes; empty hides
- **GIVEN** the grouped panel is open with pending `p1`
- **WHEN** a new free-floating `p2` arrives
- **THEN** `p2` SHALL append to the panel stack
- **AND** `p1` SHALL remain in the panel without being remounted
- **WHEN** `p1` and `p2` are both answered or cancelled
- **THEN** the grouped panel SHALL no longer render

#### Scenario: A single free-floating ask renders as a one-card panel
- **GIVEN** exactly one pending free-floating ask `p1`
- **THEN** the grouped panel SHALL render containing one answerable card
- **AND** `p1` SHALL NOT also render inline in the message stream

#### Scenario: A widget-bar-owned ask never enters the panel
- **GIVEN** a pending ask `pw` whose prompt component is of a widget-bar
  registered type
- **AND** a pending free-floating ask `p1`
- **THEN** `pw` SHALL render in its widget-bar slot only
- **AND** `pw` SHALL NOT appear in the grouped panel

#### Scenario: A widget-bar ask carrying a toolCallId stays in its slot
- **GIVEN** a pending ask `pw` of a widget-bar registered type that also
  carries a `toolCallId`
- **THEN** `pw` SHALL render in its widget-bar slot only
- **AND** `pw` SHALL NOT appear in the grouped panel

#### Scenario: A batch ask occupies one slot in the stack
- **GIVEN** a pending free-floating ask with `method:"batch"`
- **AND** one other pending free-floating confirm `p1`
- **THEN** the grouped panel SHALL render both
- **AND** the batch entry SHALL render as its BatchRenderer wizard in one slot
- **AND** the batch entry SHALL keep its atomic `{answers}` resolution
