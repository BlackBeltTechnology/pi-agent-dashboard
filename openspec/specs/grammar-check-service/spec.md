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

### Requirement: LLM corrections are never silently swallowed

When the `llm` backend returns a `correctedText` that differs from the submitted text but NO
itemized `suggestions` can be surfaced — either because the model returned an empty `suggestions`
array, or because every returned suggestion's `original` is not an exact substring of the input
and was therefore dropped as untrustworthy — the service SHALL synthesize a single whole-text
`GrammarSuggestion` spanning the entire input (`offset: 0`, `length: <input length>`, `original`
= the submitted text, `replacement` = the corrected text, `kind: "grammar"`). The result SHALL
therefore never report "No issues found" when the model actually changed the text.

The changed/unchanged comparison SHALL ignore leading and trailing whitespace, and the fallback
SHALL NOT fire on empty input. Before the comparison and before the result is returned, the
service SHALL strip a single echoed `<text>…</text>` wrapper from `correctedText` (the wrapper the
LLM prompt instructs the model to omit), so a wrapper-only difference is treated as no change and
an applied correction never leaks the tags into the draft.

Individual itemized suggestions SHALL still be preferred when at least one survives: the whole-text
fallback is used only when zero itemized suggestions remain.

#### Scenario: Model rewrites the text but returns no suggestions
- **WHEN** the `llm` backend returns a `correctedText` that differs (ignoring surrounding
  whitespace) from the input and an empty `suggestions` array
- **THEN** the result SHALL contain exactly one `GrammarSuggestion` spanning the whole input
  whose `replacement` is the corrected text
- **AND** the `summary` SHALL NOT be "No issues found"

#### Scenario: Every itemized suggestion is dropped as a non-substring
- **WHEN** the `llm` backend returns a changed `correctedText` together with one or more
  suggestions whose `original` is not an exact substring of the input
- **THEN** those suggestions SHALL be dropped as untrustworthy
- **AND** a single whole-text correction SHALL be surfaced in their place

#### Scenario: At least one valid suggestion suppresses the fallback
- **WHEN** the `llm` backend returns a changed `correctedText` and at least one suggestion whose
  `original` is an exact substring of the input
- **THEN** only the itemized suggestion(s) SHALL be returned
- **AND** the whole-text fallback SHALL NOT be added

#### Scenario: Genuinely clean text surfaces no correction
- **WHEN** the `llm` backend returns a `correctedText` equal to the input (ignoring surrounding
  whitespace) and an empty `suggestions` array
- **THEN** the result SHALL contain zero suggestions
- **AND** the `summary` SHALL be "No issues found"

#### Scenario: Echoed <text> wrapper is stripped
- **WHEN** the model returns `correctedText` wrapped in `<text>…</text>` tags
- **THEN** the wrapper SHALL be removed before the result is returned and before the
  changed/unchanged comparison
- **AND** a wrapper-only difference SHALL NOT trigger a whole-text correction

