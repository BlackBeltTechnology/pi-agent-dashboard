## MODIFIED Requirements

### Requirement: Persona injection per turn

Before every spawn or resume, the plugin SHALL render the persona to a file outside the target directory and SHALL spawn with `scope.appendSystemPrompt` naming that file, `scope.noContextFiles: true`, `scope.noProjectTrust: true` and `scope.sessionDir` set to pi's default session folder for the target directory under the host's sessions root, so the session file is written where the host discovers it whatever the project configures, and so the persona is part of the base system prompt, no `AGENTS.md`/`CLAUDE.md` context file is discovered, and no trust-gated project resource (`.pi/settings.json`, `.pi/mcp.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, `.agents/skills`) is loaded. For a project with `contextFiles: true`, the plugin SHALL additionally append the project root's `AGENTS.md` and `CLAUDE.md`, each only when it resolves inside the project root, is a regular file and is at most 64 KiB, after the persona file. Every spawn or resume SHALL also set `scope.noSkills: true` and `scope.skills` to the absolute paths of the conversation's effective skills (the persona's `skills` resolved through the skill catalog), so no discovered, settings-configured or package skill is loaded. On every ensure (create, resume, and reuse of a live session), the plugin SHALL answer `409 skill_not_allowed` with body `{ error, skill, reason }` (`reason` ∈ `missing`|`invalid`|`users`|`targets`, naming the first failing skill in persona order) and SHALL NOT spawn when any of the persona's skills is missing from the catalog, has an invalid path, or is not allowed for the caller and target. On the reuse path it SHALL also end the live session. If a managed catalog change lands between this check and the session registering, the plugin SHALL re-check once the session is live and SHALL abort it with the same `409` when it is now blocked. If the spawned skill set after host composition differs from the effective set, the plugin SHALL refuse the start instead of running with fewer skills. A persona edit SHALL take effect when a session next starts or resumes. A conversation SHALL be flagged `personaStale` when its persona changed after its session started, and `POST .../conversations/:id/restart` SHALL end its live session while keeping the record, so the next open resumes the same transcript with the current persona.

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

#### Scenario: Global skills not loaded
- **WHEN** the operator has `~/.pi/agent/skills/release-cut/SKILL.md` and alice opens a conversation with a persona that lists no skills
- **THEN** the session is spawned with `--no-skills` and no `--skill` flag
- **AND** the provider-bound prompt lists no skill

#### Scenario: Granted skill loaded
- **WHEN** a persona lists `review`, and `review` is allowed for alice in `billing`
- **THEN** the session is spawned with `--no-skills --skill <review path>`

#### Scenario: Skill no longer allowed
- **WHEN** an admin removes `billing` from `review`'s targets, and alice then opens her ended conversation with a persona that lists `review` in `billing`
- **THEN** the response is `409 skill_not_allowed` with `skill: "review", reason: "targets"`, nothing is spawned and the conversation record is unchanged

### Requirement: Tool presets and file confinement

A team session SHALL only run with the team extension active: the plugin SHALL refuse to spawn when the extension file is missing (`503 guard_unavailable`), and SHALL abort a spawned session whose extension does not send its readiness plugin message within the spawn timeout. A team session SHALL be spawned with a tool allowlist from the persona preset: `chat` = `read, grep, find, ls`; `files` = `chat` + `write, edit`; `full` = `files` + `bash`. The team extension SHALL block, before execution, every tool call whose tool name is not in the preset (including extension, MCP and codemode tools), and every file-tool call whose path, canonicalised through its longest existing ancestor with symlinks resolved, lies outside the target directory (project root or own workspace), except that a `read`, `grep`, `find` or `ls` call SHALL be allowed when its canonicalised path lies inside the root of one of the session's effective skills (the skill's directory); `write` and `edit` SHALL stay confined to the target directory. A call with no path argument targets the target directory. The team extension SHALL remove every skill whose file is not inside an effective skill root from the system prompt before each agent run, without replacing the rest of the prompt. A skill command SHALL be recognised by one shared rule in every layer: the text starts with exactly `/skill:`, the name runs up to the first whitespace, and an empty name is not a command. The extension SHALL also refuse, without expanding it, any user input `/skill:<name>` where `<name>` is not an effective skill, and any input that is a skill envelope (`<skill name=… location=…>`) whose location is not inside an effective skill root. This covers skills added at runtime by other extensions. In a team session the dashboard bridge SHALL NOT expand prompt templates or skills from disk or from pi's command registry. It SHALL expand a leading `/skill:<name>` (single or multi-line) only when `<name>` is an effective skill, from that skill's own `SKILL.md`, in the same `<skill name location>` envelope as outside team sessions. It SHALL refuse any other `/skill:`, and any effective skill whose `SKILL.md` cannot be read at send time, with "skill not available" feedback, settling the pending prompt, before it is queued or buffered, and SHALL never send such text unexpanded. In a team session the bridge SHALL NOT dispatch extension commands, run executable templates, take the flow fast-path, or send with prompt-template expansion enabled, whatever the input's line structure. The team extension SHALL treat a missing or unparseable skill policy as an unusable policy (no readiness signal), like an unparseable tool policy. The `full` preset is exempt from the skill-confinement guarantees, because its `bash` can read any file. It SHALL block when the policy or a path cannot be parsed, and with an unparseable policy it SHALL show no skill in the prompt and refuse every `/skill:` input.

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

#### Scenario: Granted skill readable
- **WHEN** a `chat` persona with effective skill `review` (root `/opt/skills/review`) reads `/opt/skills/review/SKILL.md` and `/opt/skills/review/references/x.md`
- **THEN** both reads are allowed

#### Scenario: Granted skill not writable
- **WHEN** a `files` persona with effective skill `review` edits `/opt/skills/review/SKILL.md`
- **THEN** the call is blocked

#### Scenario: Sibling of a skill root blocked
- **WHEN** a persona with effective skill root `/opt/skills/review` reads `/opt/skills/release/SKILL.md`, or follows a symlink inside the root that points outside it
- **THEN** the call is blocked

#### Scenario: Extension-discovered skill hidden
- **WHEN** another loaded extension adds skill `memory-x` through `resources_discover` in a team session whose effective skills are `[review]`
- **THEN** the provider-bound prompt lists `review` and not `memory-x`
- **AND** the bridge session-context fragment and the persona are still in the prompt

#### Scenario: Leaked skill command refused
- **WHEN** alice sends `/skill:memory-x do it` in a session whose effective skills are `[review]`
- **THEN** the input is not expanded, no model turn starts and alice sees "skill not available"

#### Scenario: Granted skill command works
- **WHEN** alice sends `/skill:review` in that session
- **THEN** the skill is expanded as usual

#### Scenario: Bridge expansion cannot leak
- **WHEN** alice sends the multi-line text `/skill:memory-x\nsummarise` from the team app, in a session whose effective skills are `[review]`, while `memory-x` is registered in pi's command list by another extension
- **THEN** no skill text is read or sent, no model turn starts and alice sees "skill not available"

#### Scenario: Granted skill works single-line from the app
- **WHEN** alice sends the single-line `/skill:review check the PR` from the team app
- **THEN** the bridge expands `review` from its own file, and the turn runs with the skill envelope followed by `check the PR`

#### Scenario: Project prompt templates not expanded
- **WHEN** project `billing` contains `.pi/prompts/deploy.md` and alice sends `/deploy\nnow`
- **THEN** the text reaches the model unexpanded

#### Scenario: Reuse of a live session re-checks
- **WHEN** alice's session with a persona listing `review` is live, the operator removes `review` from the config file, and alice reopens the conversation
- **THEN** the live session is ended and the response is `409 skill_not_allowed`

#### Scenario: Refused skill command is not queued
- **WHEN** alice sends `/skill:memory-x` while her session is streaming
- **THEN** nothing is added to the follow-up queue and she sees "skill not available"

#### Scenario: Same-name leaked skill removed
- **WHEN** an extension adds a skill named `review` from a different directory than the granted `review` root
- **THEN** the provider-bound prompt lists only the granted `review`

#### Scenario: Unreadable granted skill fails closed
- **WHEN** the granted `review` directory is deleted while alice's session is live, and she sends `/skill:review go`
- **THEN** nothing is sent to the model, the pending prompt settles, and she sees "skill not available"

#### Scenario: No extension command or exec template in team sessions
- **WHEN** a team session's cwd has an `executable: bash` prompt template `x`, and alice sends `/x` and then `/x\nargs`, and a registered extension command `/y`
- **THEN** no command is dispatched, no bash runs, and no text is sent with template expansion enabled

#### Scenario: Missing skill policy aborts the spawn
- **WHEN** a team session starts without a parseable skill policy in its environment
- **THEN** the team extension does not signal readiness, and the ensure answers `503 guard_unavailable`

