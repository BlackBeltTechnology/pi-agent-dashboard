## REMOVED Requirements

### Requirement: Switchable backend

**Reason**: The service no longer switches backends. The LanguageTool backend is
removed, leaving a single LLM path; a "switchable backend" requirement mandates a
choice point (`config.grammar.backend`, the `GrammarBackend.check` common
interface across two implementations) that no longer exists.

**Migration**: The surviving LLM path is re-stated unconditionally by the ADDED
"Single LLM grammar backend" requirement below, which carries the former
"LLM backend selected" scenario as the only behaviour. The `languagetool`
dispatch, `config.grammar.backend`, and the `config.grammar.languagetool` block
are deleted; `parseGrammarConfig` drops any persisted values on read (see
`grammar-settings-plugin` → "Settings controls read/write the plugin config
namespace `plugins.grammar`").

### Requirement: Backend failures are typed and non-leaky

**Reason**: The prior requirement's "LanguageTool server down" scenario is
unreachable once the LanguageTool backend is removed. Replaced wholesale by the
ADDED "LLM backend failures are typed and non-leaky" (renamed so the delta is an
explicit remove+add, not a silent MODIFIED scenario drop).

**Migration**: See the ADDED "LLM backend failures are typed and non-leaky" below.

### Requirement: Grammar health probe

**Reason**: The prior requirement's "Health reports active backend" scenario
asserted a LanguageTool reachability probe in the payload, gone with the
backend. Replaced wholesale by the ADDED "LLM grammar health probe".

**Migration**: See the ADDED "LLM grammar health probe" below.

## ADDED Requirements

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
