## MODIFIED Requirements

### Requirement: Board session rows render status stripes identical to the sidebar card

Each `BoardSessionRow` in the OpenSpec board SHALL render the same `.card-stripes-fx` status-stripe overlay that `SessionCard` renders, derived through the same `getCardPulseClass` → `getCardStripeFxClass` chain. The mapping SHALL be: `status === "streaming" || resuming` → `card-stripes-running` (yellow); `currentTool === "ask_user"` → `card-stripes-input` (purple, highest precedence); `unread` → `card-stripes-unread` (cyan); otherwise no overlay. The overlay SHALL be `aria-hidden` and rendered behind row content. When the `fx-status-animation` effect resolves off (see `card-visual-effects`), the overlay SHALL render as a static tint in the same state color with no animation, exactly as the sidebar card does.

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

#### Scenario: Effects off keeps rows identical to cards

- **GIVEN** `fx-status-animation` resolves off
- **WHEN** a board session row and its sidebar card render for a streaming session
- **THEN** both SHALL carry `card-stripes-fx card-stripes-running`
- **AND** neither overlay SHALL animate
