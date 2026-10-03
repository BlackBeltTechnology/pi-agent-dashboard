## ADDED Requirements

### Requirement: One persistent session per user and persona

`POST /api/plugins/team/agents/:key/session` SHALL return the caller's session for that persona, choosing in order: reuse a live, not-ended session recorded for the caller whose cwd is the caller's workspace for that persona, whose `principalOwner` equals the caller and whose `pluginRefs.team.personaKey` equals `:key`; else resume the recorded session file with `resume:{sessionFile}` when that file exists and its persisted owner equals the caller (a missing or different owner SHALL NOT be resumed); else spawn a fresh session. A fresh or resumed session SHALL be spawned with `pluginRef.principalOwner` set to the caller and `pluginRef.team = { personaKey, uk, runId }` where `runId` is a fresh nonce, and SHALL be correlated by that `runId`. The instance record SHALL be written only after the session is correlated, and SHALL NOT be written on failure. On a spawn timeout the in-flight spawn SHALL be aborted.

#### Scenario: First open spawns
- **WHEN** alice opens `shared:backend` for the first time
- **THEN** one session is spawned in alice's workspace for that persona, owned by alice
- **AND** alice's instance record holds its `sessionId` and `sessionFile`

#### Scenario: Reopen reuses
- **WHEN** alice opens it again while the session is live
- **THEN** the same `sessionId` is returned and nothing is spawned

#### Scenario: Ended session resumes
- **WHEN** the session has ended and alice opens it
- **THEN** a spawn with `resume.sessionFile` equal to the recorded file runs and the transcript continues

#### Scenario: Foreign session never adopted
- **WHEN** a recorded session's `principalOwner` is not alice
- **THEN** it is neither reused nor resumed and a fresh session is spawned

#### Scenario: Ownerless transcript not resumed
- **WHEN** the recorded session file's persisted metadata has no `principalOwner`
- **THEN** it is not resumed and a fresh session is spawned

#### Scenario: Spawn timeout leaves no record and no orphan
- **WHEN** the host does not resolve the spawn within 30 s
- **THEN** the response is `504 spawn_timeout`, the instance record is unchanged, and the spawn is aborted by the spawn token the plugin minted for it

#### Scenario: Correlation by nonce
- **WHEN** an earlier aborted spawn for the same user and persona registers late
- **THEN** it is not bound to the instance record, because its `runId` differs

### Requirement: Single-flight per user and persona

Concurrent ensure requests for the same `(user, persona)` SHALL share one in-flight operation and SHALL result in at most one spawn.

#### Scenario: Double click
- **WHEN** two ensure requests for alice + `shared:backend` arrive together
- **THEN** exactly one spawn runs and both receive the same `sessionId`

### Requirement: Per-user agent workspace

Each `(user, persona)` SHALL have a workspace directory `users/<uk>/agents/<scope>-<slug>/` under the team home, created on first ensure and used as the session cwd. `uk` SHALL be derived from a hash of `(iss, sub)` (the local operator uses `local`), so raw subject ids never appear in paths. Reset and persona deletion SHALL NOT delete the workspace.

#### Scenario: Two users, one persona
- **WHEN** alice and bob both open `shared:backend`
- **THEN** their sessions run in two different workspace directories

### Requirement: Persona injection per turn

Before every spawn or resume, the plugin SHALL render the persona to a file outside the workspace and SHALL spawn with `scope.appendSystemPrompt` naming that file and `scope.noContextFiles: true`, so the persona is part of the base system prompt and no `AGENTS.md`/`CLAUDE.md` context file is loaded. A persona edit SHALL take effect when the session next starts or resumes. `GET /agents` SHALL flag an instance `personaStale` when its persona changed after the session started, and `POST /api/plugins/team/agents/:key/restart` SHALL end the live session while keeping the instance record, so the next open resumes the same transcript with the current persona.

#### Scenario: Edit applies after restart
- **WHEN** an admin changes `shared:backend` instructions while alice's session is live
- **THEN** alice's card shows `personaStale`
- **AND** after alice restarts it, her next prompt runs with the new instructions and the earlier transcript is still shown

#### Scenario: Operator context not leaked
- **WHEN** the operator's agent-dir `AGENTS.md` exists
- **THEN** its content is not part of a team session's system prompt

#### Scenario: Persona cannot move the bridge anchor
- **WHEN** a persona's instructions contain a line starting with `Current working directory: `
- **THEN** the provider-bound prompt still contains the whole persona and the bridge's session-context fragment

#### Scenario: Bridge context survives
- **WHEN** the dashboard bridge is loaded in a team session
- **THEN** the system prompt sent to the provider contains both the persona and the bridge's session-context fragment

### Requirement: Tool presets and file confinement

A team session SHALL only run with the team extension active: the plugin SHALL refuse to spawn when the extension file is missing (`503 guard_unavailable`), and SHALL abort a spawned session whose extension does not send its readiness plugin message within the spawn timeout. A team session SHALL be spawned with a tool allowlist from the persona preset: `chat` = `read, grep, find, ls`; `files` = `chat` + `write, edit`; `full` = `files` + `bash`. The team extension SHALL block, before execution, every tool call whose tool name is not in the preset (including extension, MCP and codemode tools), and every file-tool call whose path, canonicalised through its longest existing ancestor with symlinks resolved, lies outside the workspace; a call with no path argument targets the workspace. It SHALL block when the policy or a path cannot be parsed.

#### Scenario: Escape blocked
- **WHEN** an agent calls `read` on `../../<other-uk>/agents/x/notes.md`
- **THEN** the call is blocked and the file is not read

#### Scenario: Symlink escape blocked
- **WHEN** the workspace contains a symlink to `/etc` and the agent reads through it
- **THEN** the call is blocked

#### Scenario: Extension tools blocked
- **WHEN** a `chat` persona session calls `update_roles`, `write` or `bash`
- **THEN** each call is blocked before execution

#### Scenario: Guard missing fails closed
- **WHEN** the team extension does not signal readiness after a spawn
- **THEN** the session is aborted, no instance record is written, and the response is `503 guard_unavailable`

#### Scenario: New file outside workspace blocked
- **WHEN** a `files` persona writes `../other/new.txt` that does not exist yet
- **THEN** the call is blocked

### Requirement: Agent status and idle ending

`GET /api/plugins/team/agents` SHALL list every persona visible to the caller with a status of `new`, `sleeping`, `running`, `busy`, `retired` or `unavailable`, computed from the caller's instance records and one pass over live sessions, and SHALL never spawn. An idle sweep SHALL run every 5 minutes and SHALL gracefully end each team session whose last completed agent run ended longer ago than the configured `idleMinutes` (default 30, `0` disables); a streaming session SHALL never be ended by the idle rule; its next open SHALL resume it. Idleness SHALL be measured only from live (not replayed) events of the plugin's own sessions and SHALL survive a server restart.

#### Scenario: Idle session sleeps
- **WHEN** alice's session has been idle for 31 minutes with the default config and a sweep runs
- **THEN** it is ended and her card shows `sleeping`

#### Scenario: Not yet idle
- **WHEN** a sweep runs 29 minutes after the session's last run
- **THEN** the session is not ended

#### Scenario: Long turn not interrupted
- **WHEN** an agent run has been streaming for 45 minutes with the default config
- **THEN** the session is not ended

#### Scenario: Listing does not spawn
- **WHEN** a user with three never-opened personas calls `GET /agents`
- **THEN** all three are `new` and no session is spawned

### Requirement: Reset conversation

`POST /api/plugins/team/agents/:key/reset` SHALL end the caller's live session for that persona (if any) and clear its instance record, so the next open spawns fresh. The old session file and the workspace SHALL be kept.

#### Scenario: Fresh start
- **WHEN** alice resets `shared:backend` and opens it again
- **THEN** a new `sessionId` is returned with an empty transcript and the workspace files are still present

### Requirement: Route authorization and observability

Every team route SHALL require a principal whenever identity is active (`401` otherwise); when identity is inactive the plugin SHALL run in single-user mode where every caller admitted by the host is the local operator; SHALL act only on the caller's own instances, and SHALL log each ensure outcome (`reuse`, `resume`, `spawn`, `timeout`) with the user key, persona key and session id and without persona content.

#### Scenario: Anonymous refused
- **WHEN** identity is active and a request has no principal
- **THEN** the response is `401` and no session is touched
