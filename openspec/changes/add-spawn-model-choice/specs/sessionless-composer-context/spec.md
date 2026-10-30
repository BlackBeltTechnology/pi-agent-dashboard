## MODIFIED Requirements

### Requirement: Spawn-time model and thinking reach pi

A `spawn_session` carrying `model` and/or `thinkingLevel` SHALL start pi with that model and thinking level, and the dashboard's configured default model and default thinking level SHALL NOT override either value; when only `thinkingLevel` is carried and a default model is configured, the session SHALL run that default model with the carried thinking level. When no `thinkingLevel` field is carried, a `model` ending in `:<level>` for a valid thinking level SHALL be treated as that model plus that thinking level; when a `thinkingLevel` field is carried, the model SHALL be used as given. The server SHALL accept `model` only as a `provider/id` string of at most 200 characters from a restricted character set (letters, digits, `.`, `_`, `-`, and in the id also `:`, `@`, `/`, `+`), with a non-empty provider and id and no `/`-separated segment empty or starting with `-`, and `thinkingLevel` only from `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. A `model` beginning with `@` SHALL instead be treated as a role reference (`@role` or `@role:<level>`) and resolved once at spawn time against `~/.pi/agent/providers.json#roles` into a concrete `provider/id` (plus level), which is then validated as above. An invalid value or an unresolvable role SHALL be ignored, the spawn SHALL proceed without it, and `spawn_result` SHALL carry a `choiceWarning` describing what was dropped. Values SHALL never be interpreted by a shell: they SHALL be passed as discrete arguments or, where a launch path builds a command string, escaped per argument.

#### Scenario: Valid choices start pi with them

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5", thinkingLevel: "high" }`
- **THEN** pi SHALL be started in `/p` with model `anthropic/claude-sonnet-5` and thinking level `high`

#### Scenario: Multi-segment model id is accepted

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "openrouter/meta-llama/llama-4" }`
- **THEN** pi SHALL be started with model `openrouter/meta-llama/llama-4`

#### Scenario: Shell-shaped model is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "x; rm -rf /" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Flag-shaped model is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "--help/x" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Unknown thinking level is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", thinkingLevel: "turbo" }`
- **THEN** pi SHALL be started in `/p` without a thinking argument

#### Scenario: Thinking suffix on the model is split

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5:high" }`
- **THEN** pi SHALL be started with model `anthropic/claude-sonnet-5` and thinking level `high`

#### Scenario: Explicit thinking level field disables suffix splitting

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5:high", thinkingLevel: "low" }`
- **THEN** pi SHALL be started with model `anthropic/claude-sonnet-5:high` and thinking level `low`

#### Scenario: Slash-less model is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "sonnet" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Dash-led id segment is ignored

- **WHEN** the server receives `spawn_session { cwd: "/p", model: "a/b/--x" }`
- **THEN** pi SHALL be started in `/p` without a model argument

#### Scenario: Model value is not shell-interpreted on tmux

- **GIVEN** the tmux spawn strategy
- **WHEN** a `spawn_session` carries a valid model containing shell-significant characters such as `@` or `+`
- **THEN** the pane command SHALL pass the model as one escaped argument

#### Scenario: Thinking without a model is not overridden by the default

- **GIVEN** the dashboard default model is `anthropic/claude-opus-5-5` with default thinking level `medium`
- **WHEN** the server receives `spawn_session { cwd: "/p", thinkingLevel: "high" }`
- **THEN** the started session SHALL run `anthropic/claude-opus-5-5` with thinking level `high`

#### Scenario: Explicit thinking beats the configured default

- **GIVEN** the dashboard default thinking level is `medium`
- **WHEN** the server receives `spawn_session { cwd: "/p", model: "anthropic/claude-sonnet-5", thinkingLevel: "high" }`
- **THEN** the started session SHALL run with thinking level `high`

#### Scenario: Role reference is resolved, not ignored

- **GIVEN** `providers.json#roles` assigns `fast` to `anthropic/claude-haiku-5-5`
- **WHEN** the server receives `spawn_session { cwd: "/p", model: "@fast" }`
- **THEN** pi SHALL be started with model `anthropic/claude-haiku-5-5`

#### Scenario: Unresolvable role is ignored with a warning

- **GIVEN** no role `ghost` is configured
- **WHEN** the server receives `spawn_session { cwd: "/p", model: "@ghost" }`
- **THEN** pi SHALL be started in `/p` without a model argument
- **AND** `spawn_result` SHALL carry a `choiceWarning`
