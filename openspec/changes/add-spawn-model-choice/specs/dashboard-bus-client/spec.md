## ADDED Requirements

### Requirement: Bus spawn carries the spawn choice

The bus client's `spawn` SHALL accept optional `model` (a `provider/id` or `@role` reference) and `thinkingLevel` and SHALL send them on `spawn_session`. `spawn` SHALL keep resolving with the session id string. When the server's `spawn_result` carries `choiceWarning`, `spawn` SHALL call the optional `onWarning(warning)` callback from `SpawnOptions`. The `dashboard-bus.ts spawn` CLI SHALL accept `--model <ref>` and `--thinking <level>` and SHALL print `warning: <choiceWarning>` when one is returned.

#### Scenario: Spawn with a role over the bus
- **WHEN** `client.spawn({cwd:"/p", model:"@planning", thinkingLevel:"high"})` is called
- **THEN** the sent `spawn_session` SHALL carry `model: "@planning"` and `thinkingLevel: "high"`

#### Scenario: Library caller receives the warning
- **GIVEN** the server answers with a `choiceWarning`
- **WHEN** `client.spawn({cwd:"/p", model:"@ghost", onWarning})` resolves
- **THEN** it SHALL resolve with the session id and `onWarning` SHALL have been called once with the warning

#### Scenario: Dropped choice surfaced by the CLI
- **GIVEN** the server answers `spawn_result {success:true, choiceWarning:"role 'ghost' not configured yet"}`
- **WHEN** `dashboard-bus.ts spawn /p --model @ghost` runs
- **THEN** it SHALL print the spawned session id and `warning: role 'ghost' not configured yet`
