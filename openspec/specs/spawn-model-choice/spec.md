# spawn-model-choice Specification

## Purpose
TBD - created by archiving change add-spawn-model-choice. Update Purpose after archive.

## Requirements

### Requirement: One spawn-choice resolver serves every spawn road

The server SHALL resolve the spawn-time model through one resolver shared by every spawn road: browser WS `spawn_session`, `POST /api/session/spawn`, the plugin `spawnSession` hook (and the MCP tool bound to it), and the bridge `spawn_new_session`. `model` MAY be `provider/id`, `provider/id:<level>`, `@role` or `@role:<level>`. An `@role` reference SHALL be resolved once, at spawn time, against `~/.pi/agent/providers.json#roles`. pi SHALL then receive the role's concrete `provider/id` as `--model`, without a level suffix. The roles file SHALL be read only for `@` refs. Literal refs SHALL keep each road's existing validation semantics.

#### Scenario: Role resolved at spawn time
- **GIVEN** `providers.json#roles` contains `planning: "anthropic/claude-opus-5-5:high"`
- **WHEN** a spawn arrives with `model: "@planning"` and no `thinkingLevel`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-opus-5-5` and `--thinking high`

#### Scenario: Spawned session does not follow later role edits
- **GIVEN** a session was spawned from `@planning` while it resolved to model A
- **WHEN** role `planning` is later reassigned to model B
- **THEN** the running session's model SHALL remain A

#### Scenario: Literal ref reads no roles file
- **WHEN** a spawn arrives with `model: "openai/gpt-6"`
- **THEN** the resolver SHALL NOT read `providers.json`

### Requirement: Role thinking level follows one precedence

For an `@role` ref the resolver SHALL pick the thinking level by precedence: explicit `thinkingLevel` field > ref `:<level>` suffix > role-assigned level. The level SHALL never be appended to `--model`. On every road, a choice carrying only a thinking level SHALL be paired with the configured default model when one exists. When the configured default model is a role ref (`@<role>` or `@<role>:<level>`), the pairing SHALL resolve it against the current role map first and pair the resolved `provider/id`, with the choice's explicit thinking level winning. When the pairing's default role ref does not resolve (unknown role, unassigned, or assigned a value without `provider/`), the spawn SHALL proceed without `--model`, the failure SHALL be logged, and the pairing SHALL NOT add a warning, a `choiceWarning`, or a REST error, because the request itself carried no model. A request that carries the role ref as its own `model` (for example a spawn surface that promoted the Settings default) SHALL keep the existing unresolvable-role handling of the dropped-choice requirement.

#### Scenario: Explicit thinking level beats the role level
- **GIVEN** role `planning` is assigned `anthropic/claude-opus-5-5:high`
- **WHEN** a spawn arrives with `model: "@planning"` and `thinkingLevel: "low"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-opus-5-5` and `--thinking low`

#### Scenario: Ref suffix beats the role level
- **GIVEN** role `planning` is assigned `anthropic/claude-opus-5-5:high`
- **WHEN** a spawn arrives with `model: "@planning:medium"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-opus-5-5` and `--thinking medium`

#### Scenario: Thinking-only choice pairs with the default model
- **GIVEN** Settings `defaultModel` is `anthropic/claude-sonnet-5-5`
- **WHEN** a REST or plugin spawn arrives with only `thinkingLevel: "high"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-sonnet-5-5 --thinking high`

#### Scenario: Thinking-only choice pairs with a role default
- **GIVEN** Settings `defaultModel` is `@planning` and role `planning` is assigned `anthropic/claude-sonnet-5-5:high`
- **WHEN** a REST or plugin spawn arrives with only `thinkingLevel: "low"`
- **THEN** pi SHALL be spawned with `--model anthropic/claude-sonnet-5-5 --thinking low`

#### Scenario: Thinking-only choice with an unresolved role default
- **GIVEN** Settings `defaultModel` is `@validate` and `validate` has no model in the current role map
- **WHEN** a REST spawn arrives with only `thinkingLevel: "low"`
- **THEN** the request SHALL succeed
- **AND** pi SHALL be spawned without `--model` and with `--thinking low`

#### Scenario: Promoted role default that does not resolve warns
- **GIVEN** Settings `defaultModel` is `@validate` and `validate` has no model in the current role map
- **WHEN** the user spawns from the folder home without changing the model chip
- **THEN** pi SHALL be spawned without `--model`
- **AND** `spawn_result` SHALL carry a `choiceWarning` naming `validate`

#### Scenario: Role default reaches pi with the role level from a spawn surface
- **GIVEN** Settings `defaultModel` is `@planning`, `defaultThinkingLevel` is `""`, and role `planning` is assigned `anthropic/claude-sonnet-5-5:high`
- **WHEN** the user spawns from the folder home without changing the model or thinking chip
- **THEN** pi SHALL be spawned with `--model anthropic/claude-sonnet-5-5` and `--thinking high`

### Requirement: Dropped choices are reported on lenient roads

The browser `spawn_session` road and the plugin `spawnSession` hook SHALL keep proceeding when a model or thinking choice is dropped: they drop the choice and log a `console.warn`. A choice is dropped when it is invalid or names an unresolvable role. On the browser road a choice combined with an ACP `agent` is also dropped; the plugin hook keeps rejecting that combination. On the browser road, `spawn_result` SHALL carry an optional `choiceWarning` describing the drop. The plugin hook result SHALL carry an optional `warning`. When nothing was dropped, neither field SHALL be present. The bridge `spawn_new_session` road, which has no reply channel, SHALL only log.

#### Scenario: WS spawn with an unknown role
- **GIVEN** no role `ghost` is configured
- **WHEN** the browser sends `spawn_session {cwd:"/p", model:"@ghost"}`
- **THEN** pi SHALL be spawned without `--model`
- **AND** `spawn_result` SHALL be `success: true` with a `choiceWarning` naming `ghost`

#### Scenario: WS ACP agent with a model
- **WHEN** the browser sends `spawn_session {cwd:"/p", agent:"qmt", model:"openai/gpt-6"}`
- **THEN** the agent SHALL be started and `spawn_result` SHALL carry a `choiceWarning`

#### Scenario: Valid choice carries no warning
- **WHEN** the browser sends `spawn_session {cwd:"/p", model:"openai/gpt-6"}`
- **THEN** `spawn_result` SHALL NOT carry `choiceWarning`

### Requirement: Browser shows dropped-choice warnings

When a successful `spawn_result` carries `choiceWarning`, the web client SHALL show a non-blocking warning toast with that text. It SHALL NOT treat the spawn as failed.

#### Scenario: Remembered role became unassigned
- **GIVEN** folder `/p` remembers `@ghost` and role `ghost` was since removed
- **WHEN** the user spawns from the folder's New Session button
- **THEN** the session SHALL start and a warning toast SHALL show the `choiceWarning`

### Requirement: Bridge-initiated new session inherits the current model

When a running pi session asks the dashboard for a new session (`spawn_new_session`), the bridge SHALL include its current `model` (`provider/id`) and `thinkingLevel` when known. The server SHALL spawn the new session with them through the shared resolver. When the bridge does not know its model, it SHALL omit both fields and the spawn SHALL behave as before.

#### Scenario: Terminal new session inherits
- **GIVEN** a terminal pi session running `anthropic/claude-sonnet-5-5` at thinking `medium`
- **WHEN** it triggers a new dashboard session
- **THEN** the new pi SHALL be spawned with `--model anthropic/claude-sonnet-5-5 --thinking medium`

#### Scenario: Unknown current model
- **GIVEN** the bridge has no cached model
- **WHEN** it triggers a new dashboard session
- **THEN** `spawn_new_session` SHALL carry no `model` or `thinkingLevel`
