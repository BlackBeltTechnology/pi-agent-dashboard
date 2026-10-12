## ADDED Requirements

### Requirement: Team sessions run without pi's built-in MCP support

Every team-session spawn and resume SHALL set `scope.noMcp: true`, for every tool preset (`chat`, `files`, `full`), so pi connects no MCP server (Pi-global or project) and registers no MCP tool in the session. The team extension's deny-first name gate SHALL keep blocking every tool call whose name is not in the preset, `mcp__*` names included, as defence in depth against MCP support that `--no-mcp` does not cover (an extension that replaces pi's built-in MCP).

#### Scenario: A persona spawn carries --no-mcp
- **WHEN** a conversation starts a team session for a persona with the `chat` preset
- **THEN** the spawn scope SHALL carry `noMcp: true`
- **AND** the spawned argv SHALL contain `--tools read,grep,find,ls` and `--no-mcp`

#### Scenario: Every preset disables MCP
- **WHEN** team sessions are spawned for personas with the `files` and `full` presets
- **THEN** each spawn scope SHALL carry `noMcp: true`

#### Scenario: Resume keeps MCP disabled
- **WHEN** an existing conversation resumes its session file
- **THEN** the resume spawn scope SHALL carry `noMcp: true`

#### Scenario: The guard still blocks MCP names
- **WHEN** a team session receives a tool call named `mcp__docs__search`
- **THEN** the team extension SHALL block it before execution, whatever the preset
