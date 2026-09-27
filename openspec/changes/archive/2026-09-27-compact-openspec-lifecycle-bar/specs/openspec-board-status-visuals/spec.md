## MODIFIED Requirements

### Requirement: Proposal card shows an aggregate status stripe from its child sessions

Each `ProposalCard` SHALL paint a single `.card-stripes-fx` overlay derived from the most-urgent state across its child session rows via `deriveProposalCardState`. Precedence SHALL be: any child in `ask_user` → `card-stripes-input`; else any child running/streaming/resuming → `card-stripes-running`; else any child unread → `card-stripes-unread`; else no overlay. A proposal whose children are all ended/idle/complete SHALL render no card-level overlay.

#### Scenario: Card aggregates to the most-urgent child

- **GIVEN** a proposal card with one child session in `ask_user` and another in `streaming`
- **WHEN** the board renders
- **THEN** the card root SHALL carry the `card-stripes-input` overlay.

#### Scenario: Completed proposal shows no stripe

- **GIVEN** a proposal card whose every child session is `ended`
- **THEN** the card SHALL render no `.card-stripes-fx` overlay, leaving the change's lifecycle phase to the card's lifecycle bar, which derives from the change state and not from session status.
