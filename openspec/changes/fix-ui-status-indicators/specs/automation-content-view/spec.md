## ADDED Requirements

### Requirement: Board distinguishes loading, error and empty

The Automation board SHALL show a loading state until its first definitions fetch settles, an error state with a Retry control when the fetch fails (network error or non-2xx), and the "No automations in this folder" empty state only when the fetch succeeds with zero definitions. A failed fetch SHALL NOT render the empty state or a blank list. Retry SHALL re-run the fetch; the board chrome (title, Create, Show archived) SHALL render in every state.

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
- **THEN** the 2 definitions SHALL render and the error SHALL clear

#### Scenario: Successful empty fetch shows the explainer
- **WHEN** the request succeeds with zero definitions
- **THEN** the empty state with the Create action SHALL render
