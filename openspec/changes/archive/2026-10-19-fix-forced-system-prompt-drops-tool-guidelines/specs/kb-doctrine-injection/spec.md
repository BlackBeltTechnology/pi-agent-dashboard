## ADDED Requirements

### Requirement: Every kb retrieval tool is listed in the system prompt
Each tool the kb extension registers (`kb_search`, `kb_get`, `kb_neighbors`, `kb_guard_pause`) SHALL declare a one-line prompt snippet, so pi lists it in the system prompt's `<tools>` section whenever it is active. Each SHALL also contribute at least one usage guideline to the `<rules>` section. The `kb_guard_pause` guideline SHALL state that it is for bulk exploration only, never a way to skip a kb lookup.

#### Scenario: All kb tools appear in the tools section
- **WHEN** an agent run starts with `kb_search`, `kb_get`, `kb_neighbors` and `kb_guard_pause` active
- **THEN** the system prompt's `<tools>` section SHALL contain one line for each of the four tools

#### Scenario: kb tool guidelines appear in the rules section
- **WHEN** an agent run starts with the kb tools active
- **THEN** the `<rules>` section SHALL contain at least one guideline mentioning each of `kb_get`, `kb_neighbors` and `kb_guard_pause`
- **AND** the `kb_guard_pause` guideline SHALL say it must not be used to skip a kb lookup

#### Scenario: Inactive tool is not listed
- **WHEN** `kb_guard_pause` is not in the active tool set
- **THEN** neither its `<tools>` line nor its guideline SHALL appear

## MODIFIED Requirements

### Requirement: Doctrine is appended to the system prompt per turn
When the kb extension is loaded for a cwd and the resolved `doctrine.inject` is `kb`, the extension SHALL add the canonical READ doctrine to the system prompt on every agent turn, as the structured custom section named `dox_doctrine` (`event.systemPromptOptions.sections.dox_doctrine`), whose content begins with the recognisable `── dox doctrine ──` marker line. When `doctrine.inject` is `off`, no `dox_doctrine` section SHALL be contributed. The text SHALL be the same canonical doctrine text previously seeded by `project-init`; this change SHALL NOT reduce the doctrine content. First-contact and legacy-migration instructions SHALL be delivered through the same `dox_doctrine` section. The extension SHALL NOT return a `systemPrompt` value and SHALL NOT set `forceSystemPrompt`.

#### Scenario: READ doctrine injected
- **WHEN** the extension is active in a cwd whose resolved `doctrine.inject` is `kb`
- **THEN** the system prompt for that turn contains the READ doctrine under the `── dox doctrine ──` marker inside the `dox_doctrine` section
- **AND** the handler returns no `systemPrompt`

#### Scenario: Injection disabled
- **WHEN** the resolved `doctrine.inject` is `off`
- **THEN** the system prompt contains no `── dox doctrine ──` fragment
- **AND** `doctrine.write` has no effect

#### Scenario: Coexists with other prompt injectors
- **WHEN** another extension also contributes to the system prompt in the same turn, either as a structured section (e.g. the dashboard bridge `dashboard_session` section) or as a tool/prompt guideline (e.g. the roles plugin's Agent guideline)
- **THEN** all contributions are present in the system prompt sent to the provider, regardless of handler order

#### Scenario: Config resolved per turn from the session cwd
- **WHEN** the project config file is written during a session
- **THEN** the next turn's injection reflects the new `doctrine` value without restarting the session

#### Scenario: Malformed project config
- **WHEN** `.pi/dashboard/knowledge_base.json` in the session cwd is invalid JSON or fails validation
- **THEN** the built-in defaults apply for that turn (READ injected, WRITE not)
- **AND** no first-contact instruction is injected
- **AND** a `[kb]`-prefixed warning is emitted to the console once per session

#### Scenario: Doctrine file unreadable
- **WHEN** the bundled canonical doctrine file cannot be read
- **THEN** no `dox_doctrine` section is contributed
- **AND** a `[kb]`-prefixed warning is emitted once per session

#### Scenario: Handler latency budget
- **WHEN** the handler runs 100 turns against a warm project config
- **THEN** p95 wall time of the handler (config reads + fragment build + section write) is below 20 ms

#### Scenario: Extension reload does not stack handlers
- **WHEN** the extension is reloaded mid-session
- **THEN** the next turn's system prompt contains exactly one `── dox doctrine ──` fragment
