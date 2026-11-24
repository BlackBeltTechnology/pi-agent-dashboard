## ADDED Requirements

### Requirement: Agent definition resolution

`TeammateSpawn` SHALL accept an optional `agent` name (`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`). The plugin SHALL resolve it against the team `leadCwd`: first `<leadCwd>/.pi/agents/<agent>.md` (only when the project is trusted), then `<piAgentDir>/agents/<agent>.md`, reading regular files of at most 64 KiB inside those directories. An untrusted project file SHALL NOT shadow a user file. A missing name SHALL fail with `agent_not_found`, an untrusted-only one with `agent_untrusted`.

#### Scenario: Project agent in a trusted project
- **WHEN** `.pi/agents/Audit.md` exists and the project is trusted
- **THEN** `TeammateSpawn {agent:"Audit"}` uses that definition

#### Scenario: Untrusted project without fallback
- **WHEN** the project is untrusted and only `.pi/agents/Audit.md` exists
- **THEN** the spawn fails with `agent_untrusted` and no member is started

#### Scenario: Untrusted project falls through to user
- **WHEN** the project is untrusted, `.pi/agents/Audit.md` exists and `<piAgentDir>/agents/Audit.md` also exists
- **THEN** the user definition is used

#### Scenario: User tier
- **WHEN** only `<piAgentDir>/agents/Explore.md` exists
- **THEN** it is used

#### Scenario: Invalid agent name or size
- **WHEN** the `agent` name is `../x`, longer than 64 characters or empty, or the file exceeds 64 KiB
- **THEN** the spawn fails with `agent_invalid`, no member is started and nothing outside the agents directories is read

### Requirement: Agent field mapping

The plugin SHALL map `description` to the default member role (the agent name when absent), `model` verbatim to the spawn model, `thinking` to the spawn thinking level when it is a known level (an unknown level is ignored with a warning), `tools` to the tool allowlist, and `prompt` (else the markdown body, possibly empty) to a prompt file. `tools` SHALL be accepted only as a YAML array; any other type SHALL fail the spawn with `agent_invalid` instead of widening to all tools.

#### Scenario: Comma string refused
- **WHEN** an agent file has `tools: read, bash`
- **THEN** the spawn fails with `agent_invalid` and the member is not started with all tools

#### Scenario: Body becomes the role prompt
- **WHEN** an agent file has no `prompt:` key and a markdown body
- **THEN** the body becomes the agent prompt file of the member

#### Scenario: Unknown thinking level
- **WHEN** an agent file has `thinking: ludicrous`
- **THEN** the level is ignored, a warning is recorded and the spawn proceeds

#### Scenario: Bare agent file
- **WHEN** an agent file has no description, no prompt key and an empty body
- **THEN** the role is the agent name, the prompt file is empty and the spawn proceeds

### Requirement: Field precedence

For each field the first defined source SHALL win: spawn argument, template member, agent definition, team default. This SHALL apply to `model` (`defaultModel`), `tools` (`defaultTools`) and `skills` (`defaultSkills`; agent definitions carry none); `cwd` SHALL still pass the core cwd confinement. `requirePlanApproval` SHALL only be strengthened by a spawn argument (`false`, `true`, `"user"` in that order), never relaxed below the template value.

#### Scenario: Spawn argument wins
- **WHEN** the agent definition says model `@fast` and the spawn argument says `@coding` with no template declaration
- **THEN** the member runs with `@coding`

#### Scenario: Agent default used
- **WHEN** neither spawn argument nor template member sets a model and the agent says `@fast`
- **THEN** the member runs with `@fast`

#### Scenario: cwd cannot widen
- **WHEN** a template member sets a cwd outside the lead cwd and `extraCwdRoots`
- **THEN** the spawn fails with `cwd_outside_lead`

#### Scenario: Lead cannot relax plan approval
- **WHEN** the template member requires `"user"` and the lead spawns it with `requirePlanApproval:false`
- **THEN** the member still requires `"user"`

#### Scenario: Lead can strengthen plan approval
- **WHEN** the template member has `false` and the lead spawns it with `requirePlanApproval:true`
- **THEN** the member requires plan approval

#### Scenario: Lead-chosen model beats the template model
- **WHEN** the template member sets model `@fast` and the lead spawns it with `@coding`
- **THEN** the member runs with `@coding` (model is not a ceiling or floor)

### Requirement: Template ceiling for lead-supplied lists

When a template declares `tools` or `skills` for a member or as a team default, a list supplied by the lead in `TeammateSpawn` SHALL be intersected with the declared list. A result that would be empty or that names an entry outside the declared list SHALL fail with `tools_outside_template` or `skills_outside_template`. A declared empty list SHALL allow nothing optional. Without a template declaration the core behaviour SHALL apply.

#### Scenario: Lead cannot widen
- **WHEN** the template member allows `[read, grep]` and the lead passes `tools:[read, bash]`
- **THEN** the spawn fails with `tools_outside_template`

#### Scenario: Lead can narrow
- **WHEN** the template member allows `[read, grep]` and the lead passes `tools:[read]`
- **THEN** the member's tools are `[read]` plus the team tools

#### Scenario: Declared empty skills list
- **WHEN** the template declares `defaultSkills: []` and the lead passes `skills:[a]`
- **THEN** the spawn fails with `skills_outside_template`

#### Scenario: Declared empty tools list
- **WHEN** the template member declares `tools: []`
- **THEN** the member has only the team tools and a lead-supplied `tools:[read]` fails with `tools_outside_template`

### Requirement: Prompt files and spawn prompt

The plugin SHALL register a core spawn contributor that appends the agent prompt file and then the template member `prompt` file after the core protocol file, in that order. The core spawn prompt (team header, role, spawn prompt) SHALL carry the goal. The server SHALL NOT use `initialPrompt`.

#### Scenario: Prompt order
- **WHEN** a member has an agent prompt and a template member prompt
- **THEN** its prompt files are the protocol file, the agent file, then the member file

#### Scenario: Eager spawn prompt
- **WHEN** an eager member is spawned from a template with goal `fix login`
- **THEN** its first `spawn_prompt` mail contains the goal and no `initialPrompt` was used

### Requirement: inherit_context is ignored

The agent definition field `inherit_context` SHALL have no effect on teammates. A teammate SHALL receive only the team header, role prompts and the spawn prompt, never the lead's history.

#### Scenario: Inherit flag set
- **WHEN** the agent file declares `inherit_context: true`
- **THEN** the teammate's first prompt contains none of the lead's conversation

### Requirement: Team tools survive the allowlist

After precedence and ceiling, the server SHALL append the teammate tool names from the core role table (extended by this change with `PlanSubmit` for teammates and `PlanDecision` for the lead) to the resulting tool list, so an agent definition's `tools` cannot remove the member's ability to use the team.

#### Scenario: Agent without team tools
- **WHEN** the agent definition lists `tools: [read]`
- **THEN** the member can still call `TaskList` and `SendMessage`
