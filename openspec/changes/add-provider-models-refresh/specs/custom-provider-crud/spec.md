## ADDED Requirements

### Requirement: Single-provider models refresh endpoint

The server SHALL expose `POST /api/providers/:name/refresh` that re-fetches one custom provider's model list without changing `providers.json`. For a name present in `providers.json#providers` it SHALL: broadcast `credentials_updated` carrying `refreshProviders: [name]` to connected pi sessions, refresh the server model registry, re-probe that provider's endpoint, cache the probe result as the provider's health, and respond `200` with `{ success: true, health }`. The response SHALL await the probe (bounded by the probe timeout) so the caller sees the fresh model count. An unknown name SHALL respond `404` and broadcast nothing. A corrupt `providers.json` SHALL respond `409` with the same refusal body as the write routes. The route SHALL write nothing to `providers.json` and SHALL never include an API key in its response body or log output. The server model-registry refresh MAY re-discover every custom provider; only the session-side re-discovery is scoped to the named provider.

#### Scenario: Refresh re-probes and returns fresh health

- **WHEN** `POST /api/providers/proxy/refresh` is called and `proxy` exists
- **AND** its endpoint now lists 7 models
- **THEN** the response SHALL be `200` with `health.ok === true` and `health.modelCount === 7`
- **AND** `GET /api/providers` SHALL return the same cached health for `proxy`

#### Scenario: Refresh notifies sessions with the provider scope

- **WHEN** `POST /api/providers/proxy/refresh` succeeds
- **THEN** the server SHALL broadcast `credentials_updated` with `refreshProviders` equal to `["proxy"]`

#### Scenario: Unknown provider

- **WHEN** `POST /api/providers/missing/refresh` is called and `missing` is not in `providers.json`
- **THEN** the response SHALL be `404`
- **AND** no `credentials_updated` SHALL be broadcast

#### Scenario: Unreachable endpoint

- **WHEN** the provider's endpoint is unreachable
- **THEN** the response SHALL be `200` with `health.ok === false` and an error message
- **AND** sessions SHALL still be notified

#### Scenario: File is not modified

- **WHEN** a refresh completes
- **THEN** `providers.json` content and mtime SHALL be unchanged

### Requirement: Models refresh route is tiered and manifest-bound

`POST /api/providers/:name/refresh` SHALL carry a route-tier entry at the same tier as the single-provider write routes and SHALL be bound in the MCP tool manifest or explicitly denylisted.

#### Scenario: Route carries a tier

- **WHEN** the route tier table is read
- **THEN** it SHALL contain an entry for `POST /api/providers/:name/refresh`

#### Scenario: Route is manifest-bound or denylisted

- **WHEN** the manifest-completeness check runs over `/api/*`
- **THEN** it SHALL find the route bound or explicitly denylisted

### Requirement: Custom-endpoint rows offer a Refresh models control

Each custom-endpoint row in Settings → Providers SHALL render a **Refresh models** button outside edit mode. The button SHALL be disabled while a refresh for that row is in flight or the row's removal is pending, so repeated activation issues one request. Activating it SHALL call the refresh endpoint for that row's provider, disable the button and show an in-flight indicator until the response, then render the returned health in that row's health pill and notify the settings catalogue that provider models changed. A failed request SHALL render an inline error on the row and leave the row interactive.

#### Scenario: Refresh updates the row pill

- **WHEN** the user clicks Refresh models on the `proxy` row
- **AND** the endpoint returns `health.modelCount === 7`
- **THEN** the button SHALL be disabled with an in-flight indicator until the response
- **AND** the `proxy` pill SHALL then show 7 models

#### Scenario: Double activation issues one request

- **WHEN** the user clicks Refresh models twice before the first response
- **THEN** exactly one refresh request SHALL be sent

#### Scenario: Refresh failure is inline

- **WHEN** the refresh request fails (network error or non-2xx)
- **THEN** the row SHALL show an inline error
- **AND** the button SHALL be enabled again
