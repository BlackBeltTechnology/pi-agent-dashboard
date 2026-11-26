## ADDED Requirements

### Requirement: Isolated teammate context

An in-process teammate SHALL receive only its spawn prompt (the `spawn_prompt` mail text: team header, role, task) and the teammate protocol files, never the lead's conversation. The spawn request SHALL set `isolated: true` and `inline: true` so that neither the global inheritance setting nor an agent definition file with a matching name changes this.

#### Scenario: No lead history
- **WHEN** a teammate is spawned after a long lead conversation
- **THEN** the child's first prompt contains only the spawn prompt and protocol

#### Scenario: Name collision with an agent file
- **WHEN** an agent definition file named like the member exists
- **THEN** it is not applied to the child

### Requirement: Child tool surface and nested-team ban

A child SHALL have the member's resolved `tools` plus the teammate tool list of `TEAM_TOOLS_BY_ROLE` as extended by later changes, and nothing else from this plugin. It SHALL NOT have `TeamCreate`, `TeammateSpawn`, `ShutdownRequest`, `TeamDelete`, `Agent` or `AgentControl`, and no `ask_parent` tool.

#### Scenario: Team tools present
- **WHEN** a child starts
- **THEN** its active tools include every teammate tool of the role table and the allowlisted tools

#### Scenario: Lead tools absent
- **WHEN** a teammate model looks for `TeammateSpawn`
- **THEN** the tool is not registered in its session

#### Scenario: Later change extends the table
- **WHEN** a later change adds a teammate tool to `TEAM_TOOLS_BY_ROLE`
- **THEN** in-process children register it without a change to this plugin's child code

### Requirement: Per-child team extension

Each child SHALL load an inline extension created for its member that registers the team tools through core's `createTeamTools(transport)` over a closure transport carrying the member identity, installs core's guard layers and the plan-mode `tool_call` backstop, and holds no module-level state. It SHALL send a proxied `hello` at `session_start` with `guardActive`, `toolsActive` and `policyHash`, and core's guard-ready rule SHALL apply.

#### Scenario: Same error codes
- **WHEN** a teammate claims an already claimed task
- **THEN** it receives `already_claimed` exactly as in session mode

#### Scenario: Two children, two identities
- **WHEN** two children call `TaskUpdate` concurrently
- **THEN** each call is attributed to its own member by its token

#### Scenario: Guard missing
- **WHEN** a child's proxied `hello` reports `guardActive:false`
- **THEN** the member is `degraded: guard_unavailable`, gets no dispatch and the lead is notified

### Requirement: Bridge entry is inert inside a child

The agent-teams bridge entry SHALL register nothing and send no `hello` when it is activated in a pi instance different from the live lead activation of the same process. Ownership SHALL be released on `session_shutdown` for `reload`, `new`, `resume` and `fork`.

#### Scenario: Child activation
- **WHEN** the extension loader of a child activates the bridge entry
- **THEN** no tool, command or handler is registered and no request is sent

#### Scenario: Lead reload
- **WHEN** the lead reloads and activates the bridge again
- **THEN** the new activation takes ownership and registers normally

### Requirement: Skills in in-process teams

The child's in-place `before_agent_start` skill filter, `input` refusal and read guard SHALL apply to every grant, so an empty grant removes all skills including extension-contributed ones. A non-empty grant SHALL be refused with `skills_unavailable_in_process` unless feature `loader_skills` is present, because without it the child loads no project or user skills; with it, skills SHALL come through the loader pass-through.

#### Scenario: Empty grant
- **WHEN** a teammate is spawned with `skills: []`
- **THEN** the spawn succeeds and no skill, including extension-contributed ones, is visible in the child's prompt

#### Scenario: Skills requested without support
- **WHEN** `TeammateSpawn {skills:["a"]}` is called and the feature is absent
- **THEN** it fails with `skills_unavailable_in_process` and nothing is spawned

#### Scenario: Skills supported
- **WHEN** the feature is present and a member allows skill `a`
- **THEN** only `a` is visible in the child's prompt and `/skill:b` is refused

#### Scenario: Unrestricted grant
- **WHEN** a member has no grant and the feature is absent
- **THEN** documentation states the child sees no project or user skills

### Requirement: MCP, context files and prompt mapping

`noContextFiles` SHALL disable context file loading, and every file of the resolved `promptFiles` (protocol, then agent, then member, as built by core and contributors) SHALL be appended through the loader in order. Children SHALL have no MCP tools unless a real child proves otherwise; `noMcp` SHALL be accepted and trivially satisfied. `ResolvedSpawnSpec.env` SHALL reach the child as a closure map, never as process environment.

#### Scenario: Role prompt kept
- **WHEN** a templated member has an agent definition prompt file
- **THEN** the child's system prompt includes the protocol file, then the agent file, then the member file

#### Scenario: No MCP
- **WHEN** any child starts
- **THEN** the observed tool list contains no MCP tool and `noMcp:true` changes nothing

#### Scenario: Env is not process-wide
- **WHEN** a spawn contributor adds an `env` key
- **THEN** the child extension reads it from its closure and no process environment variable is set

### Requirement: Working directory rules

Per-member `cwd` SHALL pass core's confinement first (a `TrustedSpawnOptions.cwd` is already trusted). A directory outside the scope the subagents extension accepts SHALL be spawned with `cwdScope: "any"` only when feature `cwd_scope` is present; otherwise the spawn SHALL fail with `cwd_outside_scope`. A rejected directory SHALL never create a child.

#### Scenario: Worktree in the same repository
- **WHEN** a member cwd is a worktree of the lead's repository
- **THEN** the child starts in that directory

#### Scenario: Outside the lead's repository without the feature
- **WHEN** a member cwd passes core's check but is outside the subagents scope and the feature is absent
- **THEN** the spawn fails with `cwd_outside_scope`

#### Scenario: Core rejects first
- **WHEN** a member cwd is outside the lead cwd and `extraCwdRoots`
- **THEN** core's `cwd_outside_lead` is returned and no command is sent

### Requirement: Plan mode in a child

Where a spawn contributor marks a member as plan-mode (`PI_EXT_AGENT_TEAMS_PLAN_MODE` in the spec `env`), the child SHALL start with its final tool set, SHALL be narrowed again at the start of every run, SHALL be blocked by the `tool_call` backstop independent of narrowing, and SHALL take approval state only from the server's proxied `hello` reply `planMode`. A member the contributor does not mark is unaffected.

#### Scenario: Narrowing survives load order
- **WHEN** the subagents extension applies its tool allowlist after the team extension loaded
- **THEN** the member is narrowed again before its first model call

#### Scenario: Backstop alone
- **WHEN** narrowing is overwritten and the member calls `write`
- **THEN** the call is blocked with a plan-mode reason

#### Scenario: Approval restores
- **WHEN** a `plan_decision` mail is delivered and the proxied `hello` reports `planMode.active:false`
- **THEN** the server-provided `restoreTools` and team tools are active

### Requirement: Foreign extensions in a child

Extensions other than the agent-teams entry stay loaded in a child unless `inProcessLeanChildren` is set; their handlers and tools run scoped to that child. With `inProcessLeanChildren` the child SHALL load no discovered extension and only built-in tools plus the team extension.

#### Scenario: Misbehaving extension
- **WHEN** a third-party `before_agent_start` handler in a child throws
- **THEN** only that child's run is affected and the lead and other children continue

#### Scenario: Lean children
- **WHEN** `inProcessLeanChildren` is true
- **THEN** the spawn request disables discovered extensions and loads only the team extension

### Requirement: Unreadable prompt file

A resolved prompt file that is missing, unreadable or not valid text SHALL fail the spawn with `prompt_file_unreadable` and create no child.

#### Scenario: Missing prompt file
- **WHEN** a `promptFiles` entry cannot be read
- **THEN** the spawn fails with `prompt_file_unreadable` and no child exists
