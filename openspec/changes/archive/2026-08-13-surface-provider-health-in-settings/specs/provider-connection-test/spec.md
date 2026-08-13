## ADDED Requirements

### Requirement: Provider health is probed on save and cached

When a provider is saved (`PUT /api/providers`), the server SHALL run the same `probeProvider`
check used by `POST /api/providers/test` and store the result as that provider's cached health
`{ ok, status, error, modelCount, testedAt }`. The `POST /api/providers/test` handler SHALL also
store its result into the same cache. The server SHALL NOT probe on any panel-open/read path and
SHALL NOT run a background/periodic health poll.

The cached health SHALL be readable under the same auth posture as `/api/providers` (either folded
into the providers read payload or a sibling read), and SHALL NOT include the provider's API key or
any credential material.

#### Scenario: Save probes and caches

- **WHEN** a provider is saved via `PUT /api/providers`
- **THEN** the server SHALL run `probeProvider` for it
- **AND** store `{ ok, status, error, modelCount, testedAt }` as that provider's cached health

#### Scenario: Test updates the cache

- **WHEN** the user invokes `POST /api/providers/test` for a provider
- **THEN** the returned result SHALL be stored as that provider's cached health

#### Scenario: No probe on read

- **WHEN** the Settings → Providers panel reads provider health
- **THEN** the server SHALL return the cached result without issuing a new probe

#### Scenario: Cached health carries no credentials

- **WHEN** provider health is read
- **THEN** the payload SHALL NOT contain the provider's API key or other credential material

### Requirement: Settings → Providers renders a health pill

Each provider row in Settings → Providers SHALL render a health pill derived from the provider's
cached health, in one of four registers:

- **Connected** (green): `ok: true` — SHALL show the model count (e.g. "Connected · 142 models").
- **Error** (yellow): `ok: false` with an HTTP `status` — SHALL show the status code (e.g. "401").
- **Unreachable** (red): `ok: false` with no `status` (DNS/timeout/connection failure).
- **Not tested** (neutral): no cached health yet for that provider.

When the cached health is not `ok`, the row SHALL render the verbatim `error` string on a second
line beneath the pill, in a monospace register, so the raw cause is visible (not only the code).

The Test button SHALL update the pill (and the error line) from its response without requiring a
page reload.

Design mockup: `mockups/selector-decisions.html` decisions D2 (pill source) and D3 (outcomes +
verbatim error line).

#### Scenario: Connected pill

- **WHEN** a provider's cached health is `{ ok: true, modelCount: 142 }`
- **THEN** its row SHALL show a green pill with the model count
- **AND** SHALL NOT render an error line

#### Scenario: Auth-error pill with message

- **WHEN** a provider's cached health is `{ ok: false, status: 401, error: "invalid x-api-key" }`
- **THEN** its row SHALL show a yellow pill reading the status code
- **AND** SHALL render `invalid x-api-key` on a second line beneath the pill

#### Scenario: Unreachable pill with message

- **WHEN** a provider's cached health is `{ ok: false, error: "getaddrinfo ENOTFOUND …" }` with no `status`
- **THEN** its row SHALL show a red "Unreachable" pill
- **AND** SHALL render the raw error string on a second line

#### Scenario: Never-probed provider

- **WHEN** a provider has no cached health
- **THEN** its row SHALL show a neutral "not tested" pill and no error line

#### Scenario: Test updates the pill live

- **WHEN** the user clicks Test and the response differs from the current pill
- **THEN** the pill (and error line) SHALL update from the response without a reload
