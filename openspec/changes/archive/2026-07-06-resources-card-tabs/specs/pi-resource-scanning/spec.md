## ADDED Requirements

### Requirement: Agent resource discovery

The scanner SHALL discover subagents as a resource of `type: "agent"` from
`agents/*.md` files at both scopes: local `<cwd>/.pi/agents/` and global
`~/.pi/agent/agents/`, plus agents contributed by installed packages. Each
`PiResourceScope` returned by the scanner SHALL include an `agents` array
alongside `extensions`, `skills`, and `prompts`. A missing `agents/` directory
SHALL yield an empty array without error, matching the behavior for a missing
`skills/` directory.

#### Scenario: Local agents from agents/*.md

- **GIVEN** `<cwd>/.pi/agents/Explore.md` and `<cwd>/.pi/agents/react-expert.md` exist
- **WHEN** `scanPiResources("<cwd>")` is called
- **THEN** the `local.agents` array SHALL contain two resources with `type: "agent"`
- **AND** their `name` values SHALL be `Explore` and `react-expert`

#### Scenario: Global agents

- **GIVEN** `~/.pi/agent/agents/doc-writer.md` exists
- **WHEN** the scanner runs
- **THEN** `global.agents` SHALL contain a resource with `type: "agent"` and `name: "doc-writer"`

#### Scenario: Missing agents directory

- **GIVEN** no `agents/` directory exists at a scope
- **WHEN** the scanner runs
- **THEN** that scope's `agents` array SHALL be empty and no error SHALL be raised

### Requirement: Agent metadata parsing

For each discovered agent, the scanner SHALL parse `name`, `description`,
`model`, and `tools` from the agent file's YAML frontmatter. `model` and `tools`
SHALL be optional; when absent the corresponding fields SHALL be omitted.

#### Scenario: Agent frontmatter with model and tools

- **WHEN** an agent `.md` file contains frontmatter with `model: sonnet` and `tools: [edit, read]`
- **THEN** the agent resource SHALL include `model: "sonnet"` and a `tools` summary derived from the frontmatter value

#### Scenario: Agent without model or tools

- **WHEN** an agent `.md` file omits `model` and `tools` in its frontmatter
- **THEN** the agent resource SHALL omit `model` and `tools` and still include `name`/`description`
