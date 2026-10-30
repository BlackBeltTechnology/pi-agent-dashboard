## MODIFIED Requirements

### Requirement: Agent picker at spawn entry points
When at least one ACP agent is configured, the folder spawn button, directory home prompt, OpenSpec board spawn, worktree spawn dialog, landing page quick spawn and automation editor SHALL offer an agent choice (`pi` plus configured agents by name) and spawn with the chosen agent. The last choice SHALL be remembered per folder and preselected; a remembered agent that is no longer configured SHALL fall back to pi. Spawning a sibling from a session card or the keyboard shortcut SHALL reuse the source session's agent and, for a pi source, its `model` and `thinkingLevel`. "Initialize project" SHALL always spawn pi, with the folder's remembered model choice. With no agents configured, no spawn control SHALL show an agent choice. The folder spawn button's menu SHALL still offer the spawn model · thinking choice, which is remembered per folder and used by quick spawns in that folder (folder button, OpenSpec board spawn, Initialize project). Each field falls back on its own to the Settings default. A `default` entry in the chip clears that field from the folder memory. When the effective agent is an ACP agent, quick spawns SHALL send no model or thinking level.

#### Scenario: Picker remembers per folder
- **WHEN** the user spawns agent `qmt` from folder `/a` and later opens the spawn control of `/a` and of `/b`
- **THEN** `/a` SHALL preselect `qmt` and `/b` SHALL preselect pi

#### Scenario: Worktree dialog applies one agent to both spawn actions
- **WHEN** folder `/a` remembers agent `qmt` and the user opens the worktree spawn dialog of `/a`, then spawns into an existing worktree or creates a new one
- **THEN** the dialog SHALL show a single agent choice preselected to `qmt`, and either spawn action SHALL spawn with the agent chosen there

#### Scenario: Removed agent falls back
- **WHEN** the remembered agent for a folder is removed from `acpAgents`
- **THEN** the folder's spawn control SHALL preselect pi

#### Scenario: Sibling inherits agent
- **WHEN** the user spawns a sibling of an ACP session of agent `qmt`
- **THEN** the new session SHALL be spawned with agent `qmt` without showing a picker

#### Scenario: Sibling inherits model and thinking level
- **GIVEN** a pi session running `anthropic/claude-opus-5-5` at thinking `high`
- **WHEN** the user spawns a sibling from its card or with the keyboard shortcut
- **THEN** `spawn_session` SHALL carry `model: "anthropic/claude-opus-5-5"` and `thinkingLevel: "high"` without showing a picker

#### Scenario: No agents configured
- **WHEN** `acpAgents` is empty
- **THEN** no spawn control SHALL show an agent choice
- **AND** the folder spawn button's menu SHALL offer only the model · thinking choice

#### Scenario: Folder spawn uses the remembered model choice
- **GIVEN** the user picked `@fast` in the folder spawn button's menu of `/a`
- **WHEN** the user clicks the folder's New Session button, or spawns from the OpenSpec board of `/a`
- **THEN** `spawn_session` SHALL carry `model: "@fast"`

#### Scenario: Initialize project uses the remembered model
- **GIVEN** folder `/a` remembers `@fast` and ACP agent `qmt`
- **WHEN** the user clicks Initialize project for `/a`
- **THEN** pi (not `qmt`) SHALL be spawned and `spawn_session` SHALL carry `model: "@fast"`

#### Scenario: Remembered ACP agent wins over the remembered model
- **GIVEN** folder `/a` remembers agent `qmt` and model `@fast`
- **WHEN** the user spawns from the folder's New Session button or the OpenSpec board of `/a`
- **THEN** `spawn_session` SHALL carry `agent: "qmt"` and no `model` or `thinkingLevel`

#### Scenario: Choosing a model does not spawn
- **WHEN** the user picks a model in the folder spawn button's menu
- **THEN** no session SHALL be spawned until the main button is activated
