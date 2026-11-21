## ADDED Requirements

### Requirement: Board distinguishes loading, error and empty

The Automation board SHALL show a loading state until its definitions fetch settles, an error state with Retry when it fails (network error or non-2xx), and the empty state only when it succeeds with zero definitions. The board chrome SHALL render in every state.

#### Scenario: Pending fetch shows loading
- **WHEN** the board mounts and the definitions request has not settled
- **THEN** the list area SHALL show a loading indicator (`data-testid="automation-loading"`)
- **AND** SHALL NOT show the empty state

#### Scenario: Failed fetch shows error with retry
- **GIVEN** the definitions request returns HTTP 503 or rejects
- **THEN** the list area SHALL show an error (`data-testid="automation-error"`) and a Retry button
- **AND** SHALL NOT show "No automations in this folder"

#### Scenario: Retry recovers
- **GIVEN** the board is in the error state and the next request succeeds with 2 definitions
- **WHEN** the user activates Retry
- **THEN** `automation-loading` SHALL show until the request settles, then the 2 definitions SHALL render and the error SHALL clear

#### Scenario: Successful empty fetch shows the explainer
- **WHEN** the request succeeds with zero definitions
- **THEN** the empty state with the Create action SHALL render

#### Scenario: Mutation refresh revalidates in place
- **GIVEN** a board that loaded definitions earlier
- **WHEN** a mutation (delete, enable/disable, run now, stop, create) triggers a refresh
- **THEN** the previously loaded list SHALL stay rendered (no `automation-loading`) and card-local state, including a stop result notice, SHALL be preserved

#### Scenario: Folder change clears the list and ignores stale responses
- **GIVEN** the board is loading definitions for folder A
- **WHEN** the folder changes to B before A's request settles
- **THEN** the list SHALL be cleared and `automation-loading` SHALL show (no folder-A definitions visible)
- **AND** a late response for A, success or failure, SHALL be ignored (last-request-wins) so the board converges to B's result with no error caused by A

#### Scenario: Failed reload clears the list
- **GIVEN** a board that loaded definitions earlier
- **WHEN** a Retry or mutation refresh fetch fails
- **THEN** the board SHALL show the error state, the previously loaded list SHALL be cleared and the run-history fetches SHALL be skipped
