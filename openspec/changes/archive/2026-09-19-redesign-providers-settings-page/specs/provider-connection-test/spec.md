## RENAMED Requirements

- FROM: `### Requirement: Test button on Add Provider card`
- TO: `### Requirement: Test button on the custom-endpoint surface`

## MODIFIED Requirements

### Requirement: Test button on the custom-endpoint surface

The custom-endpoint pane of the Add-provider dialog, and the Edit state of a custom-endpoint row, SHALL each display a **Test** button. Clicking it SHALL invoke `POST /api/providers/test` with the surface's current unsaved values and display an inline status pill beneath the fields.

#### Scenario: Test is available in the row's Edit state

- **WHEN** the operator opens the Edit state of a saved custom-endpoint row
- **THEN** a Test button SHALL be present
- **AND** clicking it SHALL probe the surface's current values without writing

#### Scenario: Test button enabled state
- **WHEN** both `baseUrl` and `apiKey` fields are non-empty
- **THEN** the Test button SHALL be enabled

#### Scenario: Test button disabled state
- **WHEN** either `baseUrl` or `apiKey` is empty
- **THEN** the Test button SHALL be disabled and SHALL show a tooltip `"Enter Base URL and API Key first"`

#### Scenario: Testing in progress
- **WHEN** the user clicks Test
- **THEN** the button SHALL switch to a disabled loading state with a spinner and label `"Testing\u2026"`
- **AND** the surface SHALL display an inline status pill with text `"Testing\u2026"`

The failure/success pill uses the single visual contract defined by the
"Settings → Providers renders a health pill" requirement below (connected green /
auth-error yellow with the HTTP status / unreachable red), with the verbatim
`error` string on a monospace line beneath on failure.

#### Scenario: Test succeeds
- **WHEN** the server responds with `{ ok: true, modelCount: N, sample: [...] }`
- **THEN** the status pill SHALL show a green check with text `"Connected \u00b7 N models"` (or `"Connected"` when `modelCount` is 0 or missing)
- **AND** the pill SHALL fall back to the row's cached health when the user edits a field (baseUrl / apiKey / api)

#### Scenario: Test fails with HTTP status
- **WHEN** the server responds with `{ ok: false, status: 401, error: "..." }`
- **THEN** the status pill SHALL show a yellow pill reading the status code `"401"`
- **AND** the verbatim `error` string SHALL render on a monospace line beneath the pill

#### Scenario: Test fails with network error
- **WHEN** the server responds with `{ ok: false, error: "fetch failed: ECONNREFUSED" }` (no `status`)
- **THEN** the status pill SHALL show a red `"Unreachable"` pill
- **AND** the verbatim `error` string SHALL render on a monospace line beneath the pill

#### Scenario: Test works for already-saved providers
- **WHEN** the user clicks Test while editing a saved provider (apiKey field shows the `***` placeholder)
- **THEN** the client SHALL send `{ name, baseUrl, apiKey: "***", api }` to the endpoint
- **AND** the server SHALL resolve the real key from `providers.json` and probe upstream
- **AND** the client SHALL show the resulting success/failure pill

#### Scenario: Test does not write
- **WHEN** the user clicks Test
- **THEN** the client SHALL NOT issue any provider write

#### Scenario: Save is independent of Test
- **WHEN** the user clicks Test
- **THEN** the client SHALL NOT call `PUT /api/providers`
- **AND** the Settings Save Bar SHALL NOT open as a result of the Test
- **AND** the outcome of Test SHALL NOT gate whether the provider can be submitted

### Requirement: Provider health is probed on save and cached

When a provider is saved — through the whole-map write or a single-provider write — the server SHALL run the same `probeProvider`
check used by `POST /api/providers/test` and store the result as that provider's cached health
`{ ok, status, error, modelCount, testedAt }`. The `POST /api/providers/test` handler SHALL also
store its result into the same cache. The server SHALL NOT probe on any panel-open/read path and
SHALL NOT run a background/periodic health poll.

A single-provider write SHALL probe **only the provider it touched**, and SHALL NOT delay its response on the probe; the probe result lands in the cache and is read on the next health read. A single-provider write SHALL NOT discard another provider's cached health.

The cached health SHALL be readable under the same auth posture as `/api/providers` (either folded
into the providers read payload or a sibling read), and SHALL NOT include the provider's API key or
any credential material.

#### Scenario: Save probes and caches

- **WHEN** a provider is saved
- **THEN** the server SHALL run `probeProvider` for it
- **AND** store `{ ok, status, error, modelCount, testedAt }` as that provider's cached health

#### Scenario: A single-provider write probes only that provider

- **WHEN** one provider of five is saved through a single-provider write
- **THEN** exactly one probe SHALL be issued
- **AND** the response SHALL NOT wait for it
- **AND** the other four providers' cached health SHALL be unchanged

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

Each **custom-endpoint** row in Settings → Providers SHALL render a health pill derived from the
provider's cached health, in one of four registers. Rows backed by a credential rather than by an
endpoint (subscription, API key, environment) have no probe defined for them and SHALL NOT render a
health pill — rendering one would report "not tested" permanently.

Registers:

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

- **WHEN** a custom-endpoint provider has no cached health
- **THEN** its row SHALL show a neutral "not tested" pill and no error line

#### Scenario: Credential rows carry no pill

- **WHEN** a subscription, API-key, or environment row renders
- **THEN** it SHALL NOT render a health pill

#### Scenario: A pending write shows a pending pill

- **WHEN** a custom endpoint has just been saved and its probe has not yet landed
- **THEN** its row SHALL show a pending state
- **AND** the client SHALL issue exactly one health read about 2 s after the write response
- **AND** the row SHALL reconcile to the health that read returns

#### Scenario: Test updates the pill live

- **WHEN** the user clicks Test and the response differs from the current pill
- **THEN** the pill (and error line) SHALL update from the response without a reload

