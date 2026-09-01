## ADDED Requirements

### Requirement: Provider section degrades on a failed or malformed status response
The Settings provider section SHALL fail closed when `GET /api/provider-auth/status` does not deliver a JSON array. A non-`ok` HTTP response, a body that is not an array, or a network failure SHALL render an inline error inside the section — the section SHALL NOT throw, and SHALL NOT let an ErrorBoundary replace the surrounding Settings panel.

The section SHALL remain interactive in this state so the operator can still reach the controls that repair credentials.

#### Scenario: 500 response renders an inline error, not a white screen
- **WHEN** `GET /api/provider-auth/status` responds `500` with `{"statusCode":500,"error":"Internal Server Error","message":"..."}`
- **THEN** the section SHALL render an inline error message
- **AND** the Settings panel SHALL remain mounted
- **AND** no error SHALL propagate to the ErrorBoundary

#### Scenario: Non-array body does not crash the render
- **WHEN** the status endpoint responds `200` with a JSON object instead of an array
- **THEN** the section SHALL render an inline error and SHALL NOT invoke an array method on the body

#### Scenario: Network failure renders an inline error
- **WHEN** the status fetch rejects
- **THEN** the section SHALL render an inline error and SHALL leave the Settings panel mounted

### Requirement: OAuth status poll tolerates transient failures
The auth-code login poll SHALL treat a malformed or non-`ok` status response as a *transient* failure and continue polling, ending the flow with an error message only after a bounded number of consecutive such failures. A single failed poll — a transient `5xx`, or a server restart mid-login — SHALL NOT abort an in-flight login, and a persistent failure SHALL NOT leave the UI reporting "waiting" until the 5-minute timeout.

The poll SHALL NOT invoke an array method on a body that is not an array.

#### Scenario: One transient failure does not abort the login
- **GIVEN** an auth-code login is polling for completion
- **WHEN** a single poll returns `500`
- **AND** the next poll returns a normal status array showing the provider authenticated
- **THEN** the flow SHALL complete successfully

#### Scenario: Persistent failure ends the flow with a message
- **WHEN** consecutive polls keep returning a non-`ok` or non-array response up to the bound
- **THEN** the flow SHALL stop and SHALL display an error message
- **AND** it SHALL NOT keep reporting "waiting" until the 5-minute timeout

#### Scenario: Poll never calls an array method on a non-array
- **WHEN** a poll response body is a JSON object
- **THEN** the poll SHALL NOT throw a TypeError
