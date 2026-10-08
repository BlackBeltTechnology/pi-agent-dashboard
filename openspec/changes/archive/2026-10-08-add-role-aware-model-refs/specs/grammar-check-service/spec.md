## MODIFIED Requirements

### Requirement: Single LLM grammar backend

`checkGrammar` SHALL run every check through the LLM backend
(`config.grammar.llm` provider/model, or — when `llm` is a role ref
`{ role }` — the provider/model that role resolves to at request time),
re-reading config and role assignments per request so a settings or role/preset
change takes effect without a server restart. There SHALL be no backend
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

#### Scenario: Role ref resolves per request
- **WHEN** `config.grammar.llm` is `{ role: "@fast" }` and `fast` is assigned
- **THEN** the service SHALL call the provider/model `fast` resolves to at that request
- **WHEN** `fast` is unassigned
- **THEN** the endpoint SHALL respond with the typed `model_role_unassigned` error naming `@fast`
  and SHALL NOT attempt a provider call

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
