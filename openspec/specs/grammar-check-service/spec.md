# grammar-check-service Specification

## Purpose
TBD - created by archiving change add-composer-grammar-check. Update Purpose after archive.
## Requirements
### Requirement: Auth-gated grammar check endpoint

The dashboard server SHALL expose `POST /api/grammar/check` behind the existing auth chain.
The request body SHALL be `{ text: string, language?: string }`. On success the response
SHALL be a `GrammarCheckResult` (`{ backend, correctedText, suggestions[], summary,
language, truncated }`). The endpoint SHALL be a no-op-by-default: when
`config.grammar.enabled` is `false` it SHALL respond `409` with error code
`grammar_disabled`.

#### Scenario: Feature disabled
- **WHEN** `config.grammar.enabled` is `false` and a client POSTs to `/api/grammar/check`
- **THEN** the server SHALL respond `409` with `{ error: "grammar_disabled" }`
- **AND** SHALL NOT contact any backend

#### Scenario: Empty text rejected
- **WHEN** the feature is enabled and `text` is empty or whitespace-only
- **THEN** the server SHALL respond `400` with `{ error: "empty_text" }`

#### Scenario: Unauthenticated request rejected
- **WHEN** auth is configured and the request omits valid credentials
- **THEN** the endpoint SHALL be rejected by the existing auth chain before any backend call

#### Scenario: Successful check returns the result contract
- **WHEN** the feature is enabled and a valid `text` is submitted
- **THEN** the response SHALL contain `backend`, `correctedText`, a `suggestions` array,
  a `summary` string, the resolved `language`, and a `truncated` boolean

### Requirement: Input is capped and clipped

The server SHALL cap input at `config.grammar.maxChars`. When `text` exceeds `maxChars`,
the server SHALL clip it to `maxChars`, run the check on the clipped text, and set
`truncated: true` in the result. The server SHALL NOT forward more than `maxChars`
characters to any backend.

#### Scenario: Oversized text is clipped, not rejected
- **WHEN** `text` length exceeds `maxChars`
- **THEN** the backend SHALL receive at most `maxChars` characters
- **AND** the result SHALL have `truncated: true`

### Requirement: Switchable backend

`checkGrammar` SHALL dispatch to the backend named by `config.grammar.backend`
(`"llm"` | `"languagetool"`), re-reading config per request so a settings change takes
effect without a server restart. Each backend SHALL implement a common
`GrammarBackend.check(text, language, signal)` interface returning a `GrammarCheckResult`.

#### Scenario: LanguageTool backend selected
- **WHEN** `config.grammar.backend` is `"languagetool"`
- **THEN** the service SHALL POST to `<config.grammar.languagetool.url>/v2/check`
- **AND** SHALL map each LanguageTool `match` with a non-empty replacement to a
  `GrammarSuggestion`
- **AND** SHALL derive `correctedText` by applying non-overlapping matches to the input

#### Scenario: LLM backend selected
- **WHEN** `config.grammar.backend` is `"llm"`
- **THEN** the service SHALL call the `config.grammar.llm` provider/model with a structured
  prompt and temperature 0, resolving provider credentials server-side
- **AND** SHALL parse a strict JSON response into a `GrammarCheckResult`
- **AND** SHALL never expose provider credentials or raw provider error bodies to the client

#### Scenario: Backend switch at runtime
- **WHEN** the active backend is changed via settings and a new check is requested
- **THEN** the new backend SHALL be used without a server restart

### Requirement: Backend failures are typed and non-leaky

The endpoint SHALL respond with a typed error code (`backend_unreachable`,
`backend_timeout`, `backend_bad_response`) when a backend is unreachable, times out, or
returns an unparseable response, and SHALL NOT include stack traces, provider response
bodies, or credentials. The failure SHALL be logged to the structured logger.

#### Scenario: LanguageTool server down
- **WHEN** the configured LanguageTool URL refuses the connection
- **THEN** the endpoint SHALL respond `502` with `{ error: "backend_unreachable" }`
- **AND** SHALL log the failure with `level: "error"` (no draft text in the log)

#### Scenario: LLM returns non-JSON
- **WHEN** the LLM backend returns a body that does not parse into the result contract
- **THEN** the service SHALL return a safe result (`suggestions: []`, best-effort
  `correctedText`) or `{ error: "backend_bad_response" }`, never a 500 with a raw body

### Requirement: Grammar health probe

The server SHALL expose `GET /api/grammar/health` behind the auth chain returning
`{ enabled, backend, languagetool?: { url, reachable } }`. For the LanguageTool backend it
SHALL report whether the configured server is reachable. The probe SHALL NOT perform a full
grammar check.

#### Scenario: Health reports active backend
- **WHEN** the feature is enabled with backend `languagetool`
- **THEN** `/api/grammar/health` SHALL return `enabled: true`, `backend: "languagetool"`,
  and `languagetool.reachable` reflecting a lightweight connectivity check

### Requirement: Structured check logging without draft contents

Each `/api/grammar/check` invocation SHALL emit one structured log entry containing backend,
resolved language, input length, latency, suggestion count, and error code (if any). The log
entry SHALL NOT contain the draft text or any suggestion text.

#### Scenario: Successful check is logged
- **WHEN** a check completes
- **THEN** a structured log entry SHALL record backend, language, length, latency, and
  suggestion count
- **AND** SHALL NOT contain the submitted `text`

