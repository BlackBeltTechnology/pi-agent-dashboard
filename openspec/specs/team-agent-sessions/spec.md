# team-agent-sessions Specification

## Purpose
TBD - created by archiving change add-team-plugin. Update Purpose after archive.

## Requirements

### Requirement: Targets — projects and the own workspace

A target SHALL be either a project id (configured or folder-enabled) or `_ws`, the caller's own workspace. Every conversation SHALL run with its target directory as cwd: the project's validated `realpath`, or the caller's own workspace `users/<uk>/workspace/` under the team home, one per user and shared by all of that user's agents. `uk` SHALL be derived from a hash of `(iss, sub)` (the local operator uses `local`), so raw subject ids never appear in paths. Archiving or deleting a conversation and deleting a persona SHALL NOT delete the own workspace or project files.

#### Scenario: Agents share the own workspace
- **WHEN** alice's `shared:backend` writes `spec.md` in her own workspace and her `private:reviewer` then reads `spec.md` there
- **THEN** the reviewer reads the backend agent's content

#### Scenario: Two users, own workspaces
- **WHEN** alice and bob both talk to `shared:backend` in their own workspaces
- **THEN** the sessions run in two different directories

### Requirement: Admin-configured projects

The plugin SHALL read projects only from its config (`projects: { [id]: { name, path, users, contextFiles? } }`, id matching the slug pattern). A project SHALL be usable only when its `path` is absolute, resolves through `realpath` to an existing directory accepted by the host cwd policy, and neither contains nor lies inside the team home or the pi agent directory; this SHALL be checked at activation and on every conversation create or ensure. An invalid project SHALL be logged without its path and treated as unavailable without failing activation. In multi-user mode a project SHALL be allowed for a caller only when `users` is `"*"` or lists the caller's `(iss, sub)`; in single-user mode every valid project SHALL be allowed. `GET /api/plugins/team/projects` SHALL list the caller's allowed projects as `{ id, name, contextFiles, available }`, adding `path` only for admins. A request naming a project that is unknown or not allowed SHALL answer `404 project_not_found`; one naming an allowed project whose path no longer validates SHALL answer `409 project_unavailable`. Neither SHALL spawn. Users allowed on the same project SHALL share its files.

#### Scenario: Unlisted user
- **WHEN** project `billing` lists only alice and bob requests `GET /agents?project=billing`
- **THEN** the response is `404 project_not_found` and `billing` is absent from bob's `GET /projects`

#### Scenario: Project overlapping the team home rejected
- **WHEN** a project's path is the user's home directory and the team home lies inside it
- **THEN** the project is unavailable, the log names the project id but not the path, and the plugin still activates

#### Scenario: Path removed after activation
- **WHEN** an allowed project's directory is deleted and alice opens a conversation on it
- **THEN** the response is `409 project_unavailable`, nothing is spawned, and `GET /projects` reports it `available: false`

#### Scenario: Shared files
- **WHEN** alice's `files` agent writes `notes.md` in project `billing` and bob's agent on `billing` reads `notes.md`
- **THEN** bob's agent reads alice's content

### Requirement: Folder-enabled projects and folder matching

Besides config projects, an admin in multi-user mode, or the operator in single-user mode, SHALL be able to enable a dashboard folder as a project through `POST /api/plugins/team/projects` with the folder path, an optional name, the users allowed (`"*"` or a list of `(iss, sub)`; ignored in single-user mode) and the context-files switch. The plugin SHALL apply the same path validation as for config projects at write and on every create or ensure, SHALL store the entry atomically in the team home with the realpath as an immutable path and a unique slug id, and SHALL answer `409 project_exists` when that realpath already is a project and `403` to any other caller. Folder-enabled projects SHALL be editable (`name`, `users`, `contextFiles`) and removable by the same callers; config projects SHALL answer `409 project_readonly` to both. Removing a folder-enabled project SHALL keep every conversation record, workspace and session file and SHALL make its conversations unavailable. `POST /api/plugins/team/projects/match` SHALL map each given folder to the project whose realpath equals it, else to the nearest allowed project containing it, else to none, SHALL report only projects allowed for the caller with their agent count and active conversation count, SHALL say whether the caller may enable an unmatched folder, and SHALL never spawn.

#### Scenario: Subfolder resolves to its project
- **WHEN** `billing` is `/repo/billing-api` and alice's session runs in `/repo/billing-api/packages/core`
- **THEN** match returns `billing`, and a conversation opened from there runs with cwd `/repo/billing-api`

#### Scenario: Nearest project wins
- **WHEN** projects exist at `/repo` and `/repo/billing-api` and the folder is `/repo/billing-api/src`
- **THEN** match returns the `/repo/billing-api` project

#### Scenario: Enable a folder in multi-user mode
- **WHEN** an admin enables `/repo/marketing-site` for alice only
- **THEN** a project `marketing-site` exists, alice's match for that folder returns it, and bob's returns none with `enableable: false`

#### Scenario: Non-admin cannot enable
- **WHEN** bob posts a project in multi-user mode
- **THEN** the response is `403` and nothing is stored

#### Scenario: Disable keeps conversations
- **WHEN** the operator disables a folder-enabled project on which alice has two conversations
- **THEN** both records and session files remain, the conversations report `unavailable`, and re-enabling the same folder restores them

#### Scenario: Config project is read-only
- **WHEN** an admin patches or deletes a config project
- **THEN** the response is `409 project_readonly`

### Requirement: Agents per target

`GET /api/plugins/team/agents?project=<id|_ws>` SHALL list the personas the caller can read whose `projects` contain the target, plus personas the caller has active conversations with in that target that are no longer assigned to it (marked `unassigned`). Each entry SHALL carry the count of the caller's active conversations with it in that target, the most recent one `{ id, title, status, lastActivityAt }`, an aggregate status (`busy` if any conversation is busy, else `running`, else `sleeping`, else `new`; `retired` for a deleted persona; `unavailable` for a `full` persona in multi-user mode or an `unassigned` one) and `personaStale` when any active conversation runs an older persona version. The listing SHALL be computed from the caller's conversation records and one pass over live sessions, and SHALL never spawn.

#### Scenario: Scoped grid
- **WHEN** `shared:backend` has `projects: ["billing"]`, `shared:writer` has `projects: ["_ws"]` and alice lists `billing`
- **THEN** the listing contains `shared:backend` and not `shared:writer`

#### Scenario: Unassigned persona keeps its conversations
- **WHEN** an admin removes `billing` from `shared:backend.projects` while alice has two active conversations with it there
- **THEN** alice's `billing` listing shows `shared:backend` as `unavailable` and `unassigned` with count 2, and creating a new conversation with it there answers `409 persona_not_in_project`

#### Scenario: Listing does not spawn
- **WHEN** a user with three never-used personas lists a target
- **THEN** all three are `new` with count 0 and no session is spawned

### Requirement: Conversations

A conversation SHALL be one persistent pi session keyed by `(user, persona, target, conversationId)`, recorded in `users/<uk>/conversations/<target>/<scope>-<slug>/<conversationId>.json`. `POST /api/plugins/team/agents/:key/conversations?project=` SHALL create a conversation by spawning a fresh session, when the persona is readable, assigned to the target and the target is allowed; it SHALL answer `409 conversation_limit` when the caller already has `maxConversations` (default 50) active conversations with that persona in that target. `POST .../conversations/:id/session` SHALL return the conversation's session, choosing in order: reuse a live, not-ended session whose cwd is the target directory, whose `principalOwner` equals the caller and whose `pluginRefs.team` carries the same persona, target and conversation id; else resume the recorded session file with `resume:{sessionFile}` when that file exists and its persisted owner equals the caller ; else answer `409 conversation_unrecoverable` without spawning (a missing file, or a missing or different persisted owner, SHALL NOT be resumed). Every spawn SHALL set `pluginRef.principalOwner` to the caller and `pluginRef.team = { personaKey, project, conversationId, uk, runId }` with a fresh `runId` nonce and SHALL be correlated by it. A conversation record SHALL be created only after its first session is correlated, and an ensure SHALL update it only after correlation; nothing SHALL be written on failure, and a spawn timeout SHALL abort the in-flight spawn.

#### Scenario: New conversation spawns
- **WHEN** alice creates a conversation with `shared:backend` on `billing`
- **THEN** one session is spawned with the `billing` root as cwd, owned by alice, and a record holds its `sessionId` and `sessionFile`

#### Scenario: Several conversations, one agent
- **WHEN** alice creates two conversations with `shared:backend` on `billing`
- **THEN** two sessions with separate transcripts exist and the listing count is 2

#### Scenario: Reopen reuses
- **WHEN** alice ensures a conversation whose session is live
- **THEN** the same `sessionId` is returned and nothing is spawned

#### Scenario: Ended session resumes
- **WHEN** the conversation's session has ended and alice opens it
- **THEN** a spawn with `resume.sessionFile` equal to the recorded file runs and the transcript continues

#### Scenario: Foreign or ownerless transcript not resumed
- **WHEN** a conversation's recorded session file has a different or no persisted `principalOwner`
- **THEN** it is not resumed, nothing is spawned, and the response is `409 conversation_unrecoverable`

#### Scenario: Limit reached
- **WHEN** alice has 50 active conversations with `shared:backend` on `billing` and creates another
- **THEN** the response is `409 conversation_limit` and nothing is spawned

#### Scenario: Spawn timeout leaves no session binding and no orphan
- **WHEN** the host does not resolve a spawn within 30 s
- **THEN** the response is `504 spawn_timeout`, no conversation record is created, and the spawn is aborted by the spawn token the plugin minted for it

#### Scenario: Correlation by nonce
- **WHEN** an earlier aborted spawn for the same conversation registers late
- **THEN** it is not bound to the record, because its `runId` differs

### Requirement: Single-flight per conversation

Concurrent ensure requests for the same conversation SHALL share one in-flight operation and SHALL result in at most one spawn. Concurrent creates for the same `(user, persona, target)` SHALL be serialised so the conversation limit cannot be exceeded.

#### Scenario: Double click
- **WHEN** two ensure requests for the same conversation arrive together
- **THEN** exactly one spawn runs and both receive the same `sessionId`

#### Scenario: Racing creates at the limit
- **WHEN** alice has 49 active conversations and two creates arrive together
- **THEN** one succeeds and the other answers `409 conversation_limit`

### Requirement: Conversation titles, archive and delete

`GET .../conversations?project=&archived=` SHALL list the caller's conversations with that persona in that target, newest activity first, each with `{ id, title, status, lastActivityAt, archived, personaStale }`. The title SHALL be the user-set title when present, else the session's name, else an excerpt of the first prompt, else a dated placeholder. `PATCH .../conversations/:id` SHALL accept `title` (1–80 code points) and `archived`; archiving SHALL end a live session and hide the conversation from the default list, restoring SHALL bring it back, and restoring beyond the limit SHALL answer `409 conversation_limit`. `DELETE .../conversations/:id` SHALL end a live session and delete the record; the session file SHALL be kept on disk and SHALL NOT be reachable through the app afterwards. Archived conversations SHALL NOT count against the limit.

#### Scenario: Auto title
- **WHEN** a conversation's session is named by the dashboard and the user never renamed it
- **THEN** the listing shows the session name as its title

#### Scenario: Archive and restore
- **WHEN** alice archives a conversation and later restores it
- **THEN** it disappears from and returns to the default list, and the restored conversation resumes its transcript

#### Scenario: Delete keeps the file
- **WHEN** alice deletes a conversation
- **THEN** its record is gone, `POST .../conversations/:id/session` answers `404 conversation_not_found`, and its session file still exists

### Requirement: Persona injection per turn

Before every spawn or resume, the plugin SHALL render the persona to a file outside the target directory and SHALL spawn with `scope.appendSystemPrompt` naming that file, `scope.noContextFiles: true`, `scope.noProjectTrust: true` and `scope.sessionDir` set to pi's default session folder for the target directory under the host's sessions root, so the session file is written where the host discovers it whatever the project configures, and so the persona is part of the base system prompt, no `AGENTS.md`/`CLAUDE.md` context file is discovered, and no trust-gated project resource (`.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, `.agents/skills`) is loaded. For a project with `contextFiles: true`, the plugin SHALL additionally append the project root's `AGENTS.md` and `CLAUDE.md`, each only when it resolves inside the project root, is a regular file and is at most 64 KiB, after the persona file. A persona edit SHALL take effect when a session next starts or resumes. A conversation SHALL be flagged `personaStale` when its persona changed after its session started, and `POST .../conversations/:id/restart` SHALL end its live session while keeping the record, so the next open resumes the same transcript with the current persona.

#### Scenario: Edit applies after restart
- **WHEN** an admin changes `shared:backend` instructions while alice's conversation with it is live
- **THEN** that conversation and alice's card show `personaStale`
- **AND** after alice restarts it, her next prompt runs with the new instructions and the earlier transcript is still shown

#### Scenario: Operator context not leaked
- **WHEN** the operator's agent-dir `AGENTS.md` exists
- **THEN** its content is not part of a team session's system prompt

#### Scenario: Project context per admin switch
- **WHEN** project `billing` has a root `AGENTS.md` and a parent directory of it has another `AGENTS.md`
- **THEN** with `contextFiles: true` the provider-bound prompt contains the root file and not the parent's
- **AND** with `contextFiles` absent it contains neither

#### Scenario: Project cannot redirect session files
- **WHEN** project `billing` contains `.pi/settings.json` with `sessionDir: "./.sessions"` and alice opens a conversation on it
- **THEN** the session file is written in the host's per-cwd folder for `billing`, nothing is written under `billing/.sessions`, and after a dashboard restart her next open resumes that transcript

#### Scenario: Project resources not trusted
- **WHEN** project `billing` contains `.pi/extensions/x.ts` and `.pi/SYSTEM.md`, and the dashboard bridge is loaded
- **THEN** the extension is not loaded and the system prompt does not contain the project `SYSTEM.md`

#### Scenario: Persona cannot move the bridge anchor
- **WHEN** a persona's instructions contain a line starting with `Current working directory: `
- **THEN** the provider-bound prompt still contains the whole persona and the bridge's session-context fragment

#### Scenario: Bridge context survives
- **WHEN** the dashboard bridge is loaded in a team session
- **THEN** the system prompt sent to the provider contains both the persona and the bridge's session-context fragment

### Requirement: Tool presets and file confinement

A team session SHALL only run with the team extension active: the plugin SHALL refuse to spawn when the extension file is missing (`503 guard_unavailable`), and SHALL abort a spawned session whose extension does not send its readiness plugin message within the spawn timeout. A team session SHALL be spawned with a tool allowlist from the persona preset: `chat` = `read, grep, find, ls`; `files` = `chat` + `write, edit`; `full` = `files` + `bash`. The team extension SHALL block, before execution, every tool call whose tool name is not in the preset (including extension, MCP and codemode tools), and every file-tool call whose path, canonicalised through its longest existing ancestor with symlinks resolved, lies outside the target directory (project root or own workspace); a call with no path argument targets the target directory. It SHALL block when the policy or a path cannot be parsed.

#### Scenario: Escape blocked
- **WHEN** an agent in alice's own workspace calls `read` on `../../<other-uk>/workspace/notes.md`
- **THEN** the call is blocked and the file is not read

#### Scenario: Symlink escape blocked
- **WHEN** the own workspace contains a symlink to `/etc` and the agent reads through it
- **THEN** the call is blocked

#### Scenario: Project symlink escape blocked
- **WHEN** project `billing` contains a symlink `shared -> ../other-repo` and the agent reads `shared/README.md`
- **THEN** the call is blocked

#### Scenario: Extension tools blocked
- **WHEN** a `chat` persona session calls `update_roles`, `write` or `bash`
- **THEN** each call is blocked before execution

#### Scenario: Guard missing fails closed
- **WHEN** the team extension does not signal readiness after a spawn
- **THEN** the session is aborted, no conversation record is created or changed, and the response is `503 guard_unavailable`

#### Scenario: New file outside the target blocked
- **WHEN** a `files` persona writes `../other/new.txt` that does not exist yet
- **THEN** the call is blocked

### Requirement: Idle ending

An idle sweep SHALL run every 5 minutes and SHALL gracefully end each team session whose last completed agent run ended longer ago than the configured `idleMinutes` (default 30, `0` disables); a streaming session SHALL never be ended by the idle rule; the conversation's next open SHALL resume it. Idleness SHALL be measured only from live (not replayed) events of the plugin's own sessions and SHALL survive a server restart.

#### Scenario: Idle session sleeps
- **WHEN** a conversation's session has been idle for 31 minutes with the default config and a sweep runs
- **THEN** it is ended and the conversation shows `sleeping`

#### Scenario: Not yet idle
- **WHEN** a sweep runs 29 minutes after the session's last run
- **THEN** the session is not ended

#### Scenario: Long turn not interrupted
- **WHEN** an agent run has been streaming for 45 minutes with the default config
- **THEN** the session is not ended

### Requirement: Route authorization and observability

Every team route SHALL require a principal whenever identity is active (`401` otherwise); when identity is inactive the plugin SHALL run in single-user mode where every caller admitted by the host is the local operator; SHALL act only on the caller's own conversations (another user's conversation id SHALL answer `404 conversation_not_found`), and SHALL log each ensure outcome (`create`, `reuse`, `resume`, `timeout`, `unrecoverable`) with the user key, persona key, target, conversation id and session id and without persona content, titles or project paths.

#### Scenario: Anonymous refused
- **WHEN** identity is active and a request has no principal
- **THEN** the response is `401` and no session is touched

#### Scenario: Foreign conversation id
- **WHEN** bob calls `POST .../conversations/<alice's id>/session`
- **THEN** the response is `404 conversation_not_found` and nothing is spawned
