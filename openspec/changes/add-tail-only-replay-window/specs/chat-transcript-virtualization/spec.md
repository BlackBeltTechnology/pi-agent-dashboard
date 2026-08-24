## MODIFIED Requirements

### Requirement: Deterministic scroll-to-top affordance

The transcript SHALL provide a scroll-to-top control, symmetric to the scroll-to-bottom control, that lands the view on the first row regardless of residual estimate error. When the first row is a loading head for a head-free replay window, the control SHALL land on that row and SHALL NOT be expected to reach the session's earliest message, because earlier content is not loaded.

#### Scenario: Scroll-to-top button appears when scrolled down
- **WHEN** the transcript is scrolled away from the top by more than the scroll threshold
- **THEN** a scroll-to-top control SHALL be visible

#### Scenario: Scroll-to-top lands on the first row
- **WHEN** the user activates the scroll-to-top control
- **THEN** the view SHALL scroll so the first row is top-aligned (index 0, `align:"start"`), mounting it if unmounted, AND auto-scroll-follow SHALL be suspended until the user returns to the bottom

#### Scenario: Scroll-to-top lands on the loading head, not on the session start
- **WHEN** the transcript's first row is a loading head for a head-free window and the user activates the scroll-to-top control
- **THEN** the view SHALL top-align that loading head
- **AND** the control SHALL NOT imply that the earliest message of the session has been reached

#### Scenario: Landing on the loading head does not chain-load the whole gap
- **WHEN** the scroll-to-top control lands the view on the loading head and a servable gap remains
- **THEN** at most one backfill request SHALL result
- **AND** subsequent requests SHALL require further user scrolling

#### Scenario: Scroll-to-top does not fight the bottom-pin
- **WHEN** the scroll-to-top control is activated while content is streaming
- **THEN** the view SHALL move to the top and remain scroll-locked (not be pulled back to the bottom by the streaming bottom-pin) until the user re-arms follow
