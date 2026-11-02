## ADDED Requirements

### Requirement: Skill documents the spawn choice

The bundled `pi-dashboard` skill SHALL document, in `SKILL.md`, `references/api-reference.md`, `references/recipes.md` and `commands/dashboard-session-spawn.md`:
- the `POST /api/session/spawn` body fields `model`, `thinkingLevel`, `initialPrompt` and `attachProposal`
- `@role` and `@role:<level>` references and their one-shot resolution at spawn time
- the `400` rejection cases
- the bus CLI's `--model` / `--thinking` flags and its `choiceWarning` output.

Code samples SHALL match the real bus client API (`spawn()` resolves a session id string).

#### Scenario: Spawn command shows the model flag
- **WHEN** an agent reads `commands/dashboard-session-spawn.md`
- **THEN** it SHALL find a usage line with `--model <provider/id|@role>` and `--thinking <level>`

#### Scenario: Recipe matches the bus API
- **WHEN** an agent reads the spawn recipe in `references/recipes.md`
- **THEN** it SHALL treat `bus.spawn(...)` as returning the session id string, not `{ sessionId }`

#### Scenario: API reference lists the body fields
- **WHEN** an agent reads the `POST /api/session/spawn` section of `references/api-reference.md`
- **THEN** it SHALL find `model`, `thinkingLevel`, `initialPrompt`, `attachProposal` and the `400` cases
