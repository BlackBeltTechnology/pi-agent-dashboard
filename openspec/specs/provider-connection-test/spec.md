## Purpose

Verify a custom LLM provider's `baseUrl` + `apiKey` + `api` combination against the
upstream `/models`-style endpoint, and surface the resulting health (connected /
auth-error / unreachable / not-tested) in Settings → Providers.
## Requirements
### Requirement: Server exposes POST /api/providers/test

The dashboard server SHALL expose `POST /api/providers/test` behind the localhost/auth network guard. The endpoint accepts `{ name?: string, baseUrl: string, apiKey: string, api: string }` and performs a live HTTP probe against the provider using the per-API-type request shape, returning a structured pass/fail result.

#### Scenario: openai-completions probe succeeds
- **WHEN** the endpoint receives `{ baseUrl: "https://api.example.com/v1", apiKey: "sk-abc", api: "openai-completions" }`
- **AND** `GET https://api.example.com/v1/models` with header `Authorization: Bearer sk-abc` returns HTTP 200 with a body `{ data: [ { id: "m1" }, { id: "m2" }, ... ] }`
- **THEN** the response SHALL be `{ ok: true, status: 200, modelCount: 2, sample: ["m1", "m2"] }` (sample limited to the first 5 ids)

#### Scenario: anthropic-messages probe uses x-api-key header
- **WHEN** `api` is `anthropic-messages`
- **THEN** the probe SHALL issue `GET {baseUrl}/v1/models` with headers `x-api-key: <apiKey>` and `anthropic-version: 2023-06-01`
- **AND** SHALL NOT include an `Authorization: Bearer` header

#### Scenario: google-generative-ai probe uses key query param
- **WHEN** `api` is `google-generative-ai`
- **THEN** the probe SHALL issue `GET {baseUrl}/models?key=<urlEncodedApiKey>` with no Authorization header

#### Scenario: Provider returns 401
- **WHEN** the upstream provider returns HTTP 401
- **THEN** the response SHALL be `{ ok: false, status: 401, error: "<excerpt of response body, truncated to 500 chars>" }`

#### Scenario: Provider returns non-2xx non-auth error
- **WHEN** the upstream returns HTTP 404, 500, or any other non-2xx status
- **THEN** the response SHALL be `{ ok: false, status: <status>, error: "<body excerpt>" }`

#### Scenario: Network error or timeout
- **WHEN** the fetch fails with a network error (DNS, TCP refused) OR the probe exceeds the 8-second timeout
- **THEN** the response SHALL be `{ ok: false, error: "<error message>" }` with no `status` field
- **AND** the server process SHALL NOT crash or leak the AbortController

#### Scenario: apiKey value is a $ENV_VAR reference
- **WHEN** the submitted `apiKey` is `"$MY_LLM_KEY"` and `process.env.MY_LLM_KEY` is set
- **THEN** the probe SHALL resolve the env var and use its value in the upstream request
- **WHEN** the env var is unset
- **THEN** the response SHALL be `{ ok: false, error: "Environment variable MY_LLM_KEY is not set" }` with no upstream request issued

#### Scenario: apiKey value is the REDACTED sentinel
- **WHEN** the submitted `apiKey` is `"***"` AND a `name` field is provided AND `~/.pi/agent/providers.json` contains an entry for that name
- **THEN** the server SHALL read the live `apiKey` from the file for that provider name and use it for the probe (never including it in the response)
- **WHEN** `apiKey` is `"***"` AND no matching entry exists in providers.json
- **THEN** the response SHALL be `{ ok: false, error: "No saved API key for provider \"<name>\"" }`

#### Scenario: Response never echoes the apiKey
- **WHEN** the endpoint returns any response (success or failure)
- **THEN** the response body SHALL NOT contain the raw `apiKey` value, the `Authorization` header, or any resolved env var value

#### Scenario: Endpoint rejects non-local unauthenticated requests
- **WHEN** the request arrives from a non-loopback, non-bypassed, non-authenticated origin
- **THEN** the network guard SHALL reject the request before any upstream probe is issued

### Requirement: Test button on Add Provider card

The Settings \u2192 Providers \u2192 LLM Providers \u2192 **Add Provider** card SHALL display a **Test** button next to the Remove button. Clicking it SHALL invoke `POST /api/providers/test` with the card's current unsaved values and display an inline status pill beneath the form.

#### Scenario: Test button enabled state
- **WHEN** both `baseUrl` and `apiKey` fields are non-empty
- **THEN** the Test button SHALL be enabled

#### Scenario: Test button disabled state
- **WHEN** either `baseUrl` or `apiKey` is empty
- **THEN** the Test button SHALL be disabled and SHALL show a tooltip `"Enter Base URL and API Key first"`

#### Scenario: Testing in progress
- **WHEN** the user clicks Test
- **THEN** the button SHALL switch to a disabled loading state with a spinner and label `"Testing\u2026"`
- **AND** the card SHALL display an inline status pill with text `"Testing\u2026"`

The failure/success pill uses the single visual contract defined by the
"Settings → Providers renders a health pill" requirement below (connected green /
auth-error yellow with the HTTP status / unreachable red), with the verbatim
`error` string on a monospace line beneath on failure.

#### Scenario: Test succeeds
- **WHEN** the server responds with `{ ok: true, modelCount: N, sample: [...] }`
- **THEN** the status pill SHALL show a green check with text `"Connected \u00b7 N models"` (or `"Connected"` when `modelCount` is 0 or missing)
- **AND** the pill SHALL fall back to the row's cached health when the user edits a field (baseUrl / apiKey / api) or discards the edit

#### Scenario: Test fails with HTTP status
- **WHEN** the server responds with `{ ok: false, status: 401, error: "..." }`
- **THEN** the status pill SHALL show a yellow pill reading the status code `"401"`
- **AND** the verbatim `error` string SHALL render on a monospace line beneath the pill

#### Scenario: Test fails with network error
- **WHEN** the server responds with `{ ok: false, error: "fetch failed: ECONNREFUSED" }` (no `status`)
- **THEN** the status pill SHALL show a red `"Unreachable"` pill
- **AND** the verbatim `error` string SHALL render on a monospace line beneath the pill

#### Scenario: Test works for already-saved providers
- **WHEN** the user clicks Test on a non-new card (apiKey field shows the `***` placeholder)
- **THEN** the client SHALL send `{ name, baseUrl, apiKey: "***", api }` to the endpoint
- **AND** the server SHALL resolve the real key from `providers.json` and probe upstream
- **AND** the client SHALL show the resulting success/failure pill

#### Scenario: Save is independent of Test
- **WHEN** the user clicks Test
- **THEN** the client SHALL NOT call `PUT /api/providers`
- **AND** the card's dirty/save state SHALL be unchanged regardless of Test outcome

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

