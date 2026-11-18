## MODIFIED Requirements

### Requirement: Server exposes POST /api/providers/test

The dashboard server SHALL expose `POST /api/providers/test` behind the localhost/auth network guard. The endpoint accepts `{ name?: string, baseUrl: string, apiKey: string, api: string }` and performs a live HTTP probe against the provider using the per-API-type request shape, returning a structured pass/fail result. The probe SHALL NOT follow HTTP redirects, so the provider credential is only ever sent to the configured base URL. Base URLs compare normalised: lower-case scheme/host, default port elided, one trailing `/` stripped, query/fragment dropped; userinfo and a trailing-dot host are kept. A Base URL that is not an absolute http(s) URL is refused without a request.

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
- **WHEN** the submitted `apiKey` is `"$MY_LLM_KEY"`, `process.env.MY_LLM_KEY` is set, and a saved provider has `apiKey` `"$MY_LLM_KEY"` and the same `baseUrl` as the request
- **THEN** the probe SHALL resolve the env var and use its value in the upstream request
- **WHEN** the env var is unset
- **THEN** the response SHALL be `{ ok: false, error: "Environment variable MY_LLM_KEY is not set" }` with no upstream request issued
- **WHEN** no saved provider with that `$MY_LLM_KEY` key has the request's `baseUrl`
- **THEN** the response SHALL be `{ ok: false, error: "Environment-variable keys can only be tested with the Base URL saved with them" }` with no upstream request issued

#### Scenario: apiKey value is the REDACTED sentinel
- **WHEN** the submitted `apiKey` is `"***"` AND a `name` field is provided AND `~/.pi/agent/providers.json` contains an entry for that name whose `baseUrl` equals the request's `baseUrl`
- **THEN** the server SHALL read the live `apiKey` from the file for that provider name and use it for the probe (never including it in the response)
- **WHEN** `apiKey` is `"***"` AND no matching entry exists in providers.json
- **THEN** the response SHALL be `{ ok: false, error: "No saved API key for provider \"<name>\"" }`
- **WHEN** `apiKey` is `"***"` AND the saved entry's `baseUrl` differs from the request's
- **THEN** the response SHALL be `{ ok: false, error: "Re-enter the API key to test a changed Base URL" }` with no upstream request issued
- **WHEN** `apiKey` is `"***"` AND the request `baseUrl` differs from the saved one only by letter case of scheme/host, a trailing `/`, a default port or a query string
- **THEN** the saved key SHALL be used and the probe SHALL be issued

#### Scenario: Base URL that is not an http(s) URL

- **WHEN** the request `baseUrl` is `not a url` or a relative `/v1`
- **THEN** the response SHALL be `{ ok: false, error: "Base URL is not a valid URL" }` with no upstream request
- **WHEN** it uses another scheme such as `ftp://h/` or `file:///etc`
- **THEN** the response SHALL be `{ ok: false, error: "Base URL must use http or https" }` with no upstream request

#### Scenario: Normalisation does not hide a changed Base URL

- **WHEN** `apiKey` is `"***"` and the request `baseUrl` differs from the saved one by userinfo (`https://u:p@h/v1`), a second trailing `/` (`https://h/v1//`) or a trailing-dot host (`https://h./v1`)
- **THEN** the response SHALL be `{ ok: false, error: "Re-enter the API key to test a changed Base URL" }` with no upstream request

#### Scenario: Response never echoes the apiKey
- **WHEN** the endpoint returns any response (success or failure)
- **THEN** the response body SHALL NOT contain the raw `apiKey` value, the `Authorization` header, or any resolved env var value

#### Scenario: Endpoint rejects non-local unauthenticated requests
- **WHEN** the request arrives from a non-loopback, non-bypassed, non-authenticated origin
- **THEN** the network guard SHALL reject the request before any upstream probe is issued

#### Scenario: Provider answers with a redirect
- **WHEN** the probe target answers `302` with `Location` pointing at another host
- **THEN** the response SHALL be `{ ok: false, error: "<message naming the redirect>" }` with no `status` field
- **AND** no request (and so no `x-api-key`, `Authorization` or `key` value) SHALL reach the redirect target

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

- **WHEN** the user edits the Base URL (beyond case, trailing `/`, default port or query) and clicks Test with the `***` placeholder
- **THEN** the server SHALL refuse with `"Re-enter the API key to test a changed Base URL"` and issue no upstream request

#### Scenario: Test does not write
- **WHEN** the user clicks Test
- **THEN** the client SHALL NOT issue any provider write

#### Scenario: Save is independent of Test
- **WHEN** the user clicks Test
- **THEN** the client SHALL NOT call `PUT /api/providers`
- **AND** the Settings Save Bar SHALL NOT open as a result of the Test
- **AND** the outcome of Test SHALL NOT gate whether the provider can be submitted

## ADDED Requirements

### Requirement: Probe secrets and targets are bound to saved configuration

On `POST /api/providers/test`, a `***` or `$ENV` secret SHALL resolve only for a saved provider whose Base URL matches the request's. Every provider probe (the Test route, the probe after a save or refresh, and model discovery) SHALL vet its target before any request: a host resolving to a link-local or cloud-metadata address, or to the dashboard's own port on a local address, is refused without a request within the probe's 8-second budget. Loopback and private-LAN targets stay allowed.

#### Scenario: Metadata target is refused

- **WHEN** the request `baseUrl` resolves into `169.254.0.0/16`, `fe80::/10`, `fd00:ec2::254` (or an IPv4-mapped form), for example `http://169.254.169.254/latest`, with a literal `apiKey`
- **THEN** the response SHALL be `{ ok: false, error: "provider target is a link-local or metadata address" }` and no request SHALL be issued

#### Scenario: Dashboard's own port is refused

- **WHEN** the request `baseUrl` is `http://127.0.0.1:<dashboard port>`
- **THEN** the response SHALL be `{ ok: false, error: "provider target is this dashboard" }` and no request SHALL be issued

#### Scenario: Refusals apply in a fixed order

- **WHEN** several refusals hold for one request
- **THEN** the invalid-URL refusal SHALL win, then the secret-binding refusal, then "Environment variable X is not set", then the target vet
- **AND** an unsaved `$X` SHALL answer the binding error whether or not `X` is set

#### Scenario: A stalled DNS lookup is bounded

- **WHEN** the target host's DNS lookup does not answer
- **THEN** the probe SHALL end at the 8-second budget with `{ ok: false, error }` and no `status`, and no request SHALL be issued

#### Scenario: Local provider stays testable

- **WHEN** the request `baseUrl` is `http://localhost:11434/v1`
- **THEN** the probe SHALL be issued as before

#### Scenario: Saving a provider with a metadata Base URL sends no key

- **WHEN** a provider is saved with `baseUrl` `http://169.254.169.254/` and `apiKey` `"$ANY_ENV"`
- **THEN** the probe after the save SHALL be refused without a request, the cached health SHALL be `ok: false` with the refusal text, and model discovery for it SHALL return no models

#### Scenario: Saved-provider key resolution is unchanged

- **WHEN** the server probes or discovers a saved provider whose Base URL passes the vet
- **THEN** its `$ENV` or literal key SHALL resolve exactly as before
