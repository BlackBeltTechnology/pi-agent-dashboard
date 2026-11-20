## ADDED Requirements

### Requirement: A failed or loading overlay claim is never a blank panel

The shell SHALL NOT render an empty panel for a `shell-overlay-route` claim. While its component loads it SHALL show a loading placeholder; if the claim fails to load or throws while rendering it SHALL show a visible error panel (`data-testid="overlay-claim-error"`) with a Back control wired to the route's `onBack`. Other slots' error boundaries SHALL keep rendering nothing on failure.

#### Scenario: Claim chunk fails to load
- **GIVEN** a lazy `shell-overlay-route` claim whose module import rejects
- **WHEN** the route is opened
- **THEN** an error panel naming the claim's plugin SHALL render with a Back control
- **AND** the overlay SHALL NOT be empty

#### Scenario: Claim throws on render
- **GIVEN** a `shell-overlay-route` claim whose component throws while rendering
- **THEN** the same error panel SHALL render and activating Back SHALL call `onBack`

#### Scenario: Other slots stay silent
- **GIVEN** a `session-card-badge` claim that throws
- **THEN** the slot SHALL render nothing and siblings SHALL be unaffected
