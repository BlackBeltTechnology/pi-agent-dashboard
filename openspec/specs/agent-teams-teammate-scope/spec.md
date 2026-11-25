# agent-teams-teammate-scope Specification

## Purpose
TBD - created by archiving change add-agent-teams-core. Update Purpose after archive.

## Requirements

### Requirement: Session-mode teammate spawn

`TeammateSpawn` SHALL start each teammate as its own dashboard pi session with `pluginRef` `{"agent-teams": {teamId, member, role}}`, a pre-minted persisted `spawnToken` and `lifecycle.recover:false`, and SHALL return `status:"spawning"` before the session is live. The team header and spawn prompt (no lead history) SHALL arrive as a first waking `spawn_prompt` mail after bind and guarded `hello`, never as `initialPrompt`.

#### Scenario: Teammate sees only the spawn prompt
- **WHEN** the lead spawns `alice` with a prompt
- **THEN** her first mail contains the team header and that prompt and none of the lead's conversation

#### Scenario: Concurrent same-cwd spawns keep their own prompts
- **WHEN** two teammates spawn in the same cwd and register in reverse order
- **THEN** each receives its own `spawn_prompt`, addressed by session id

#### Scenario: Recovered teammate is not auto-resumed
- **WHEN** the dashboard crashes and recovery runs
- **THEN** a teammate is not resumed without its scope and guard env

#### Scenario: Teammate session is a normal session
- **WHEN** a teammate is live
- **THEN** it appears as an ordinary dashboard session the user can open and message

### Requirement: Spawn failure handling

A spawn that fails, or whose session has not bound, reported a guarded `hello` and acknowledged its `spawn_prompt` within `spawnTimeoutMs`, SHALL mark the member `failed`, abort the spawn by its token and send the lead a waking notice.

#### Scenario: Spawn timeout
- **WHEN** the session does not register within `spawnTimeoutMs`
- **THEN** the member is `failed`, the spawn is aborted by its token and the lead gets a waking notice

#### Scenario: Bridge never loads
- **WHEN** an allowlisted teammate binds but never reports a guarded `hello`
- **THEN** it is failed at the timeout and never treated as idle

### Requirement: Resumable teammates

The server SHALL record each member's `sessionFile` after bind and at every `hello`. `TeammateSpawn {resume:true}` for a `gone` or `disconnected` member with a recorded file SHALL respawn it with `resume {sessionFile}`, the same identity, scope and env.

#### Scenario: Resume after exit
- **WHEN** the lead resumes a `gone` member that has a session file
- **THEN** a session resuming that file is spawned and binds to the same member name

#### Scenario: Nothing to resume
- **WHEN** the member has no recorded session file
- **THEN** the call fails with `nothing_to_resume`

### Requirement: Shared lead cwd with confinement

A teammate SHALL run in the lead's cwd (`leadCwd`, from the host session record, never from payload) unless a per-member `cwd` is given; that cwd SHALL lie inside the lead cwd or an `extraCwdRoots` entry, else `cwd_outside_lead`. Unless the team `committer` is `member`, the lead SHALL be the only git committer and a teammate guard (`blockGitWrite`) SHALL refuse git writes. No file locking is provided.

#### Scenario: Default cwd
- **WHEN** no `cwd` is given
- **THEN** the teammate runs in the lead's cwd

#### Scenario: Teammate git write blocked
- **WHEN** a teammate with `committer:lead` runs `bash` with `git commit`
- **THEN** the guard blocks it with a lead-commits reason

#### Scenario: Path escape refused
- **WHEN** `cwd` resolves outside the lead cwd and all extra roots
- **THEN** the spawn fails with `cwd_outside_lead`

### Requirement: Role-based tool sets and no nested teams

The bridge SHALL register only `TeamCreate` and `TeammateSpawn` in a plain session, the lead tool set once the session is lead, and at least the teammate tool set (`TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `SendMessage`, `TeamStatus`, `ShutdownResponse`) in a teammate, all from one role table that later changes extend. A teammate SHALL NOT have `TeamCreate`, `TeammateSpawn`, `ShutdownRequest` or `TeamDelete`, and the server SHALL refuse them as `nested_team_forbidden`/`not_lead`.

#### Scenario: Teammate tool set
- **WHEN** a teammate session loads
- **THEN** its tool list contains the task tools and `ShutdownResponse` and no team-creation or spawn tool

#### Scenario: Tool forced through the lane
- **WHEN** a teammate sends a `TeammateSpawn` call directly on the request lane
- **THEN** the server fails it with `not_lead`

#### Scenario: Teammate tools exist on the first turn
- **WHEN** a teammate session starts
- **THEN** its role tools are registered at activation from the env hint, before `hello` returns

#### Scenario: Plain session pays two tools
- **WHEN** a session is neither lead nor teammate
- **THEN** only `TeamCreate` and `TeammateSpawn` are registered by this plugin

### Requirement: Per-team and per-member tool allowlist

A team default and a per-member `tools` list SHALL map to the spawn `scope.tools`, with the teammate team tools always added so they survive the allowlist. The teammate guard SHALL block a tool call whose name is outside the effective set as a backstop.

#### Scenario: Read-only reviewer
- **WHEN** a member is spawned with `tools:["read","grep","find","ls"]`
- **THEN** its session starts with those tools plus the team tools and a `bash` call is blocked

#### Scenario: Member overrides team default
- **WHEN** both a team default and a member list are set
- **THEN** the member list wins

### Requirement: Skill allowlist enforced in four layers

When a team or member skill allowlist is set (absent = unrestricted, `[]` = none), the system SHALL enforce it by (1) spawn scope `noSkills` plus resolved `skills` paths, (2) an in-place filter of `systemPromptOptions.skills` in `before_agent_start`, (3) refusal of `/skill:<name>` and skill envelopes for ungranted skills with `{action:"handled"}`, and (4) blocking `read` of `SKILL.md` files outside granted skill roots. An unresolvable skill name SHALL fail the spawn with `skill_not_found`.

#### Scenario: Extension-contributed skills are removed
- **WHEN** a teammate has an allowlist and extensions contribute extra skills
- **THEN** the model prompt lists only the allowlisted skills

#### Scenario: Ungranted slash command refused
- **WHEN** input `/skill:deploy` arrives and `deploy` is not allowed
- **THEN** the input is handled without running the skill

#### Scenario: Honest advisory limit
- **WHEN** `bash` is in the effective tool set
- **THEN** documentation and tool descriptions state that the skill limit is advisory

### Requirement: Cost scope flags

`TeammateSpawn` SHALL accept `noMcp` and `noContextFiles` (mapped to the spawn scope) and a `model`; defaults SHALL inherit the lead's project context (CC parity). The lead tool description SHALL state that each teammate costs roughly one extra full context per call and recommend 3–5 teammates.

#### Scenario: Lean reviewer
- **WHEN** a member is spawned with `noMcp:true` and `noContextFiles:true`
- **THEN** its session starts without MCP servers and without AGENTS.md discovery

### Requirement: Sleep-poll guard for teammates

When `blockSleepPolling` is true, the teammate guard SHALL block a `bash` command consisting only of `sleep N` with N at least 10 and return the reason "nothing to claim → end your turn"; the teammate prompt SHALL state that a teammate with nothing to claim ends its turn.

#### Scenario: Busy-wait blocked
- **WHEN** a teammate runs `bash` with `sleep 20`
- **THEN** the call is blocked with the end-your-turn reason

#### Scenario: Real command allowed
- **WHEN** a teammate runs `bash` with `npm test`
- **THEN** the guard allows it

### Requirement: Guard-ready handshake

A teammate with a tool or skill allowlist SHALL be treated as live only after `hello` reports `guardActive:true` with a `policyHash` equal to the server's. A bound member whose `hello` lacks the guard env, or whose team tools were intersected away by host policy, SHALL be marked `degraded` and refused team tools and dispatch, with a waking notice to the lead.

#### Scenario: Recovered teammate without guard env
- **WHEN** a bound teammate's `hello` carries no policy hash
- **THEN** it is `degraded: guard_unavailable`, gets no dispatch and the lead is notified

#### Scenario: Team tools hidden by host policy
- **WHEN** `hello` reports `toolsActive:false`
- **THEN** the member is `degraded: team_tools_unavailable` and the lead gets a waking notice

#### Scenario: Different policy hash
- **WHEN** `hello` reports a present `policyHash` different from the lead's configured policy
- **THEN** the member is `degraded: guard_mismatch`, its team tools are refused, it gets no dispatch and the lead gets a waking notice

### Requirement: Spawn argument validation

A member `cwd` that does not exist or is not a directory SHALL fail with `invalid_args` after the confinement check. An unknown or unavailable `model` SHALL fail fast with `invalid_args` before the member record is created. A spawn contributor SHALL only narrow `tools` and `skills` (intersection); a `cwd` it returns SHALL be ignored and logged once.

#### Scenario: Missing directory
- **WHEN** `TeammateSpawn` names a `cwd` inside the lead cwd that does not exist
- **THEN** the call fails with `invalid_args`

#### Scenario: Unknown model
- **WHEN** `TeammateSpawn` names an unknown `model`
- **THEN** the call fails with `invalid_args` and no member record exists

### Requirement: Sleep guard parses GNU durations

The sleep-poll guard SHALL parse GNU durations (`10s`, `10m`, floats, `1e3`, `sleep 5 5`, a trailing `;`) and block the command when the total is at least 10 seconds; the guard stays advisory.

#### Scenario: Exponent form
- **WHEN** a teammate runs `sleep 1e3`
- **THEN** the command is blocked with the end-your-turn message
