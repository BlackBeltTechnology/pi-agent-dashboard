## ADDED Requirements

### Requirement: Looked-up sessions do not affect paging
A session the client adds to its held sessions through the deep-link lookup (`GET /api/sessions?id=`) SHALL be tracked as lookup-only. Lookup-only sessions SHALL NOT count toward the `sessions_page` offset or toward the held ended sessions compared with `endedTotals`, and SHALL stop being lookup-only once a `sessions_page_result` or snapshot delivers them.

#### Scenario: Lookup row does not shift the page offset
- **GIVEN** group `g` with `endedTotals[g]` of 200, no paged sessions held for `g`, and ended session `old1` of `g` held only through the lookup
- **WHEN** the user expands the ended list of `g`
- **THEN** the client SHALL send `sessions_page { cwd: g, offset: 0 }`

#### Scenario: Paged delivery clears lookup-only
- **GIVEN** `old1` is lookup-only
- **WHEN** a `sessions_page_result` for its group contains `old1`
- **THEN** `old1` SHALL count as a paged session for later offsets and appear exactly once in that group's order
