# error-detection (delta)

## ADDED Requirements

### Requirement: Provider error message humanization

The reducer SHALL humanize a provider error string before it becomes `lastError.message` or a
retry `reason`. A pure helper `humanizeProviderError(raw)` SHALL:

- When `raw` (trimmed) is a JSON object carrying a string `error.message`, return a compact
  human line: `"<error.type>: <error.message>"` when `error.type` is a non-empty string, else
  just `"<error.message>"`.
- Otherwise (not JSON, malformed JSON, or no string `error.message`) return `raw` UNCHANGED.

The helper SHALL be applied at the settled-error extractor (`extractAgentEndError`) and at both
retry `reason` assignments (`auto_retry_waiting`, `auto_retry_start`). It SHALL NOT change WHEN
`lastError` or `retryState` are set or cleared — only the rendered text.

#### Scenario: Anthropic overloaded JSON envelope is humanized

- **WHEN** an `agent_end` arrives with `stopReason: "error"` and `errorMessage` equal to
  `{"type":"error","error":{"details":null,"type":"overloaded_error","message":"Overloaded"},"request_id":"req_x"}`
- **THEN** `SessionState.lastError.message` SHALL be `"overloaded_error: Overloaded"`
- **AND** the surface SHALL NOT render the raw JSON blob

#### Scenario: Envelope without a type renders the bare message

- **WHEN** the error envelope is `{"error":{"message":"Service unavailable"}}`
- **THEN** the humanized message SHALL be `"Service unavailable"`

#### Scenario: Plain-string errors pass through unchanged

- **WHEN** `errorMessage` is `"Rate limit exceeded"` (not JSON)
- **THEN** `SessionState.lastError.message` SHALL be `"Rate limit exceeded"`

#### Scenario: Malformed JSON passes through unchanged

- **WHEN** `errorMessage` is `"{not valid json"`
- **THEN** the value SHALL pass through unchanged as `"{not valid json"`

#### Scenario: Envelope without error.message passes through unchanged

- **WHEN** `errorMessage` is `{"type":"error","error":{"type":"overloaded_error"}}`
- **THEN** the value SHALL pass through unchanged (no string `error.message` to extract)
