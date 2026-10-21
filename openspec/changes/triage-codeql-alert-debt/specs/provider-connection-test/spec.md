## MODIFIED Requirements

### Requirement: Server exposes POST /api/providers/test

The dashboard server SHALL expose `POST /api/providers/test` behind the localhost/auth network guard. The endpoint accepts `{ name?: string, baseUrl: string, apiKey: string, api: string }` and performs a live HTTP probe against the provider using the per-API-type request shape, returning a structured pass/fail result. The probe SHALL NOT follow HTTP redirects, so the provider credential is only ever sent to the configured base URL.

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

#### Scenario: Provider answers with a redirect
- **WHEN** the probe target answers `302` with `Location` pointing at another host
- **THEN** the response SHALL be `{ ok: false, error: "<message naming the redirect>" }` with no `status` field
- **AND** no request (and so no `x-api-key`, `Authorization` or `key` value) SHALL reach the redirect target
