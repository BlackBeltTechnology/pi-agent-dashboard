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

### Requirement: The LLM prompt never instructs the model to preserve mistakes

The `llm` backend's system prompt SHALL NOT contain any wording that a model can read as an
instruction to preserve spelling, grammar, or punctuation mistakes. When `capitalizeFirstWord` is
disabled, the sentence-start exception SHALL be expressed as a narrow exception limited to the
case of the first letter of a sentence, and SHALL restate that every other mistake MUST still be
corrected. Blanket preservation phrasing (for example "leave … exactly as written") SHALL NOT be
used for that clause.

#### Scenario: Sentence-start exception is scoped and restates the mandate
- **WHEN** `capitalizeFirstWord` is disabled and a check runs against the `llm` backend
- **THEN** the system prompt SHALL still instruct the model not to change sentence-start
  capitalization
- **AND** it SHALL state that the exception covers only that letter's case
- **AND** it SHALL state that every other spelling, grammar, and punctuation mistake MUST still be
  corrected
- **AND** it SHALL NOT contain the phrase "exactly as written"

#### Scenario: The exception is absent when capitalization is enabled
- **WHEN** `capitalizeFirstWord` is enabled
- **THEN** the system prompt SHALL NOT contain the sentence-start capitalization instruction

#### Scenario: A capable model corrects a misspelled draft with the exception active
- **WHEN** `capitalizeFirstWord` is disabled AND a draft containing misspellings is checked
- **THEN** the backend SHALL return a `correctedText` that differs from the input
- **AND** SHALL report at least one suggestion, rather than reporting no issues

#### Scenario: Jargon-looking prose words are not treated as code
- **WHEN** a check runs against the `llm` backend
- **THEN** the system prompt SHALL scope its verbatim-preservation rule to code, file paths, and
  URLs
- **AND** SHALL state that an unusual, hyphenated, or technical-looking word inside ordinary prose
  is NOT code and SHALL be corrected when misspelled
- **AND** SHALL state that a misspelling is never left in place for looking like jargon, a domain
  term, or a file name, and is never treated as intentional

#### Scenario: A misspelled hyphenated term in prose is corrected
- **WHEN** a draft contains a misspelled hyphenated or domain-jargon word (for example
  `functional-specificatio`, `functianal specifican`)
- **THEN** the backend SHALL report at least one suggestion for it
- **AND** SHALL NOT return the draft unchanged on the grounds of preserving its spelling

#### Scenario: A lowercase sentence start is still preserved
- **WHEN** `capitalizeFirstWord` is disabled AND a draft begins with a lowercase letter and
  contains a misspelling
- **THEN** the misspelling SHALL be corrected
- **AND** the first letter SHALL remain lowercase

### Requirement: Single LLM grammar backend

`checkGrammar` SHALL run every check through the LLM backend
(`config.grammar.llm` provider/model), re-reading config per request so a
settings change takes effect without a server restart. There SHALL be no backend
selector: `config.grammar` SHALL carry neither a `backend` field nor a
`languagetool` block, and `parseGrammarConfig` SHALL ignore both if present in a
persisted config (graceful migration, never throwing).

#### Scenario: LLM backend runs every check
- **WHEN** an enabled, model-configured grammar check is requested
- **THEN** the service SHALL call the `config.grammar.llm` provider/model with a
  structured prompt and temperature 0, resolving provider credentials
  server-side
- **AND** SHALL parse a strict JSON response into a `GrammarCheckResult` whose
  `backend` field is `"llm"`
- **AND** SHALL never expose provider credentials or raw provider error bodies to
  the client

#### Scenario: No model configured
- **WHEN** the feature is enabled but `config.grammar.llm` is unset
- **THEN** the endpoint SHALL respond with the typed `backend_unconfigured` error
- **AND** SHALL NOT attempt a provider call

#### Scenario: Legacy LanguageTool config is coerced, not honoured
- **WHEN** a persisted config contains `backend: "languagetool"` and/or a
  `languagetool.url`
- **THEN** `parseGrammarConfig` SHALL parse successfully, dropping both fields
- **AND** the resolved config SHALL drive the LLM backend (subject to a
  configured model), never a LanguageTool call

#### Scenario: A persisted legacy key never breaks config validation
- **WHEN** an existing `plugins.grammar` on disk still carries a `backend` or
  `languagetool` key AND the config is next validated/persisted (the plugin
  config schema is `additionalProperties: false`)
- **THEN** the write/migrate path SHALL prune the legacy key(s) before validation
- **AND** validation SHALL NOT throw an `additionalProperties` error

### Requirement: LLM backend failures are typed and non-leaky

The endpoint SHALL respond with a typed error code (`backend_unreachable`,
`backend_timeout`, `backend_bad_response`, `backend_unconfigured`) when the LLM
backend is unreachable, times out, returns an unparseable response, or has no
model configured, and SHALL NOT include stack traces, provider response bodies,
or credentials. The failure SHALL be logged to the structured logger.

#### Scenario: LLM provider unreachable
- **WHEN** the configured LLM provider refuses or drops the connection
- **THEN** the endpoint SHALL respond `502` with `{ error: "backend_unreachable" }`
- **AND** SHALL log the failure with `level: "error"` (no draft text in the log)

#### Scenario: LLM returns non-JSON
- **WHEN** the LLM backend returns a body that does not parse into the result
  contract
- **THEN** the service SHALL return a safe result (`suggestions: []`, best-effort
  `correctedText`) or `{ error: "backend_bad_response" }`, never a 500 with a raw
  body

### Requirement: LLM grammar health probe

The server SHALL expose `GET /api/grammar/health` behind the auth chain returning
the non-secret client config (`enabled`, `backend`, `autoCheck`, `debounceMs`,
`minChars`, `language`, `correctionView`). The payload SHALL NOT include a
`languagetool` block, provider credentials, or the configured LLM model. The
probe SHALL NOT perform a full grammar check.

#### Scenario: Health reports the enabled feature config
- **WHEN** the feature is enabled
- **THEN** `/api/grammar/health` SHALL return `enabled: true`, `backend: "llm"`,
  and the client-driving fields (`autoCheck`, `debounceMs`, `minChars`,
  `language`, `correctionView`)
- **AND** the payload SHALL NOT contain a `languagetool` key

