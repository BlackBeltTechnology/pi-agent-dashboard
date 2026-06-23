## ADDED Requirements

### Requirement: Board session rows render status stripes identical to the sidebar card

Each `BoardSessionRow` in the OpenSpec board SHALL render the same `.card-stripes-fx` status-stripe overlay that `SessionCard` renders, derived through the same `getCardPulseClass` → `getCardStripeFxClass` chain. The mapping SHALL be: `status === "streaming" || resuming` → `card-stripes-running` (yellow); `currentTool === "ask_user"` → `card-stripes-input` (purple, highest precedence); `unread` → `card-stripes-unread` (cyan); otherwise no overlay. The overlay SHALL be `aria-hidden` and rendered behind row content.

#### Scenario: Running session row shows yellow stripes

- **GIVEN** a board session row whose session has `status === "streaming"`
- **WHEN** the board renders
- **THEN** the row root SHALL contain a child `<div>` with classes `card-stripes-fx card-stripes-running`.

#### Scenario: Blocked session row shows purple stripes with precedence

- **GIVEN** a board session row whose session has `currentTool === "ask_user"` AND `status === "streaming"`
- **WHEN** the board renders
- **THEN** the overlay class SHALL be `card-stripes-input` (ask_user wins over running).

#### Scenario: Unread session row shows cyan stripes

- **GIVEN** a board session row whose session has `unread === true` and is not streaming, resuming, or in ask_user
- **THEN** the overlay class SHALL be `card-stripes-unread`.

#### Scenario: Idle session row shows no stripes

- **GIVEN** a board session row whose session is `idle` or `ended` with no unread and no ask_user
- **THEN** the row SHALL render no `.card-stripes-fx` overlay.

### Requirement: Proposal card shows an aggregate status stripe from its child sessions

Each `ProposalCard` SHALL paint a single `.card-stripes-fx` overlay derived from the most-urgent state across its child session rows via `deriveProposalCardState`. Precedence SHALL be: any child in `ask_user` → `card-stripes-input`; else any child running/streaming/resuming → `card-stripes-running`; else any child unread → `card-stripes-unread`; else no overlay. A proposal whose children are all ended/idle/complete SHALL render no card-level overlay.

#### Scenario: Card aggregates to the most-urgent child

- **GIVEN** a proposal card with one child session in `ask_user` and another in `streaming`
- **WHEN** the board renders
- **THEN** the card root SHALL carry the `card-stripes-input` overlay.

#### Scenario: Completed proposal shows no stripe

- **GIVEN** a proposal card whose every child session is `ended`
- **THEN** the card SHALL render no `.card-stripes-fx` overlay, leaving completion to the COMPLETE state pill and task bar.

### Requirement: Board auto-scrolls the active item into view

The board SHALL scroll the active session's row into view via `scrollIntoView({ block: "nearest", behavior: "auto" })` when the selected session changes to a session that was not just clicked on the board, or when a child session transitions into `ask_user`. The board SHALL NOT scroll in response to a user clicking a row that is already visible. First-mount with a pre-selected session SHALL scroll once.

#### Scenario: External selection scrolls the row into view

- **GIVEN** a session selected from the sidebar or a deep link whose board row is off-screen
- **WHEN** the board observes the `selectedId` change
- **THEN** the board SHALL call `scrollIntoView` on the row with `data-session-id` equal to the selected id.

#### Scenario: Clicking a visible row does not jump scroll

- **GIVEN** a visible board session row
- **WHEN** the user clicks it to select
- **THEN** the board SHALL NOT call `scrollIntoView` for that selection.

### Requirement: Status-visual state mapping has a single shared implementation

The pulse/stripe state-mapping helpers (`getCardPulseClass`, `getCardStripeFxClass`, `STRIPE_FX_CLASS`, `deriveProposalCardState`) SHALL live in `packages/client/src/lib/session-status-visuals.ts` and be consumed by both `SessionCard.tsx` and `OpenSpecBoardView.tsx`. `SessionCard.tsx` MAY re-export them for backward compatibility, but SHALL NOT define a second copy.

#### Scenario: One implementation, two consumers

- **GIVEN** the helper `getCardStripeFxClass`
- **WHEN** both the sidebar card and the board row map a session's state to a stripe class
- **THEN** they SHALL resolve through the same function in `session-status-visuals.ts`, producing identical classes for identical session state.
