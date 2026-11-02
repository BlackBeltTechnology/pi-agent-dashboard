## MODIFIED Requirements

### Requirement: Session spawn REST endpoint
The dashboard server SHALL expose a `POST /api/session/spawn` endpoint that spawns a new pi session. The endpoint SHALL accept a JSON body with `cwd` (required string) and optional `agent`, `model`, `thinkingLevel`, `initialPrompt` and `attachProposal`. `model` and `thinkingLevel` SHALL be resolved through the shared spawn-choice resolver. `initialPrompt` and `attachProposal` SHALL be applied on the spawned session's registration as the browser `spawn_session` message applies them. They SHALL be withdrawn, by value, when the spawn fails. A body with only `cwd` SHALL behave as before.

#### Scenario: Spawn session
- **WHEN** a `POST /api/session/spawn` request is received with `{ "cwd": "/path/to/project" }`
- **THEN** the server SHALL spawn a new pi session in the specified directory and respond with `{ success: true }`
- **AND** pi SHALL be spawned without `--model` or `--thinking`

#### Scenario: REST spawn with a role
- **GIVEN** role `fast` is assigned `anthropic/claude-haiku-5-5`
- **WHEN** `POST /api/session/spawn {cwd:"/p", model:"@fast"}` is sent
- **THEN** the response SHALL be `success: true` and pi SHALL be spawned with `--model anthropic/claude-haiku-5-5`

#### Scenario: Initial prompt and attach applied on register
- **WHEN** `POST /api/session/spawn {cwd:"/p", initialPrompt:"hello", attachProposal:"my-change"}` succeeds and the session registers
- **THEN** the session SHALL receive `hello` as its first prompt and SHALL be attached to `my-change`

#### Scenario: Failed spawn withdraws only its own intents
- **GIVEN** an earlier spawn into `/p` queued initial prompt `A`
- **WHEN** `POST /api/session/spawn {cwd:"/p", initialPrompt:"B"}` fails to spawn
- **THEN** `B` SHALL be removed from the queue and `A` SHALL remain queued

## ADDED Requirements

### Requirement: REST spawn rejects invalid choices before any side effect

`POST /api/session/spawn` SHALL validate the whole body before filing any owner token, enqueuing anything or spawning. It SHALL return `400` with no filed or queued state and no process when:
- `model`, `thinkingLevel`, `initialPrompt` or `attachProposal` is present but not a string (an empty string SHALL count as absent, as on the WS road)
- `model` is present but invalid
- `model` names an `@role` that is not configured
- `thinkingLevel` is not a canonical thinking level
- `agent` is combined with `model` or `thinkingLevel`.

#### Scenario: Unknown role rejected
- **GIVEN** no role `ghost` is configured
- **WHEN** `POST /api/session/spawn {cwd:"/p", model:"@ghost", initialPrompt:"hi"}` is sent
- **THEN** the response SHALL be `400` naming the unresolved role
- **AND** no process SHALL be spawned and no initial prompt SHALL be queued for `/p`

#### Scenario: Invalid thinking level rejected
- **WHEN** `POST /api/session/spawn {cwd:"/p", thinkingLevel:"turbo"}` is sent
- **THEN** the response SHALL be `400` and no process SHALL be spawned

#### Scenario: ACP agent with a model rejected
- **WHEN** `POST /api/session/spawn {cwd:"/p", agent:"qmt", model:"openai/gpt-6"}` is sent
- **THEN** the response SHALL be `400` and no process SHALL be spawned
