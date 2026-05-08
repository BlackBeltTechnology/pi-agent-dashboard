## ADDED Requirements

### Requirement: Token stats not displayed in session card
Token statistics (tokensIn, tokensOut, cacheRead, cacheWrite) SHALL NOT be rendered in the SessionCard component. The server SHALL continue to accumulate and broadcast token stats. Display of token stats is deferred to SessionSidebar/detail view.

#### Scenario: Token stats not in card
- **WHEN** a session has token data
- **THEN** the SessionCard SHALL NOT render TokenStats component

#### Scenario: Server accumulation unchanged
- **WHEN** a stats_update is received from the bridge
- **THEN** the server SHALL still accumulate totals on the session record
- **AND** SHALL broadcast session_updated with updated totals
