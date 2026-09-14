## ADDED Requirements

### Requirement: Session listing is bounded, filterable and cursor-paged
The session-listing tool SHALL accept optional filter arguments, an optional
result limit and an optional opaque cursor. It SHALL apply a server-side default
limit when none is given, and SHALL enforce a hard maximum that a caller cannot
raise. An unbounded full-store response SHALL NOT be reachable.

Every response SHALL indicate whether more results exist, so a caller can
distinguish an exhausted list from a truncated page.

#### Scenario: Default call is bounded
- **WHEN** the listing tool is invoked with no arguments against a store holding more sessions than the default limit
- **THEN** the result SHALL contain at most the default number of sessions
- **AND** it SHALL indicate that more results exist

#### Scenario: Caller cannot exceed the hard maximum
- **WHEN** a caller requests a limit above the hard maximum
- **THEN** the server SHALL reject the call with an invalid-params error
- **AND** it SHALL NOT return a result page

#### Scenario: Exhausted list is distinguishable from a truncated page
- **WHEN** the final page is returned
- **THEN** the response SHALL indicate that no further results exist
- **AND** it SHALL NOT carry a continuation cursor

#### Scenario: Cursor walks the list without gaps or repeats
- **WHEN** a caller pages through the whole store using returned cursors
- **THEN** every session present for the whole walk SHALL appear exactly once

#### Scenario: Sessions sharing a sort timestamp still walk exactly once
- **WHEN** two or more sessions share the same ordering timestamp and the walk crosses the page boundary between them
- **THEN** each of those sessions SHALL appear exactly once across the walk

#### Scenario: A session created or ended mid-walk does not corrupt the walk
- **WHEN** a session is created or transitions to ended between two pages of a walk
- **THEN** no unrelated session SHALL be duplicated or skipped

#### Scenario: A session removed mid-walk does not corrupt the walk
- **WHEN** a session is removed from the store between two pages of a walk
- **THEN** the walk SHALL continue from the cursor position
- **AND** no unrelated session SHALL be duplicated or skipped

#### Scenario: Filters narrow the result set
- **WHEN** a caller supplies a status filter
- **THEN** only sessions matching that status SHALL be returned
- **AND** the reported match count SHALL reflect the filter, not the whole store

#### Scenario: Status filter accepts multiple values
- **WHEN** a caller supplies several status values in one call
- **THEN** sessions matching any of the supplied values SHALL be returned

#### Scenario: Hidden sessions are excluded by default
- **WHEN** the store contains sessions marked hidden
- **THEN** a default listing SHALL NOT include them
- **AND** the reported match count SHALL NOT count them

#### Scenario: A malformed argument is reported, not coerced
- **WHEN** a caller supplies a limit that is not a number, or a filter value outside the accepted set
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT silently substitute a default

#### Scenario: A numeric string is rejected rather than coerced
- **WHEN** a caller supplies a limit as a string containing digits
- **THEN** the server SHALL return an invalid-params error

#### Scenario: A zero or negative limit is rejected
- **WHEN** a caller supplies a limit of zero or a negative number
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT fall back to the default limit

#### Scenario: An unknown argument is rejected
- **WHEN** a caller supplies an argument name the tool does not declare
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT return a result computed as though the argument were absent

#### Scenario: A malformed cursor is rejected
- **WHEN** a caller supplies a cursor that cannot be decoded
- **THEN** the server SHALL return an invalid-params error

#### Scenario: A cursor presented with different filters is rejected
- **WHEN** a caller supplies a cursor together with filter or limit arguments differing from those that produced it
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT return a page from a different result set

#### Scenario: Validation of other tools is unchanged
- **WHEN** any other tool in the allowlist is invoked with arguments that were valid before this change
- **THEN** the call SHALL still be accepted and dispatched

#### Scenario: The advertised schema documents the bound
- **WHEN** a client reads the tool's advertised input schema and description
- **THEN** the default limit, the hard maximum and the paging argument SHALL be discoverable there
