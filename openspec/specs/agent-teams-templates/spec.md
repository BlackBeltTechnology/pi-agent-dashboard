# agent-teams-templates Specification

## Purpose
TBD - created by archiving change add-agent-teams-templates-hooks. Update Purpose after archive.

## Requirements

### Requirement: Template files and sources

The plugin SHALL discover team templates as markdown files with YAML frontmatter at `<cwd>/.pi/teams/<name>.md` (source `project`) and `<piAgentDir>/teams/<name>.md` (source `user`). The filename stem SHALL equal the frontmatter `name` (`^[a-z][a-z0-9-]{0,39}$`); the body SHALL be the lead playbook. A project template SHALL shadow a user template of the same name. A listing SHALL hold at most 200 templates; any extra SHALL be reported as a warning.

#### Scenario: User template is listed
- **WHEN** `<piAgentDir>/teams/review-pr.md` exists with `name: review-pr`
- **THEN** `team.templates` lists `review-pr` with source `user`

#### Scenario: Project shadows user
- **WHEN** both sources define `review-pr` and the project is trusted
- **THEN** the listing contains one `review-pr` with source `project`

#### Scenario: Untrusted project does not shadow
- **WHEN** both sources define `review-pr` and the project is untrusted
- **THEN** the listing shows the user `review-pr` startable and the project stem as `trusted:false`, and a start by that name uses the user template

#### Scenario: Name must match filename
- **WHEN** `a.md` declares `name: b`
- **THEN** the template is listed `invalid` with error `name_mismatch`

#### Scenario: Listing cap
- **WHEN** a source directory holds 201 valid templates
- **THEN** the listing contains the first 200 by name and one warning naming the cap

### Requirement: Start profiles and a trusted bundled source

The plugin SHALL expose `registerStartProfile(name, {preflight(goal, cwd), seed(team)})` and accept a third, trusted template source `bundled` (no hook trust prompt, listed with `source:"bundled"`) registered by later changes. `preflight` SHALL run inside `team.start` before `createTeam` or any spawn; a failure SHALL return a typed code and create nothing. `seed` SHALL run once after the lead binds and before eager members spawn.

#### Scenario: Preflight fails
- **WHEN** a profile `preflight` fails during `team.start`
- **THEN** the call returns its typed code and no team, lead or member exists

#### Scenario: Seed runs before members
- **WHEN** the lead binds for a team whose template names a start profile
- **THEN** `seed` runs once before the first eager member spawns

### Requirement: Project templates are trust-gated

The plugin SHALL read `<cwd>/.pi/teams/` only when the host service `host.isProjectTrusted(cwd)` returns true. When the service is absent or returns false, project templates SHALL be listed by file stem with `trusted:false`, SHALL NOT be parsed, and SHALL NOT be startable. User templates SHALL be unaffected.

#### Scenario: Untrusted project
- **WHEN** `host.isProjectTrusted(cwd)` is false and `.pi/teams/x.md` exists
- **THEN** `x` is listed `trusted:false`, its content is not read and `team.start x` fails with `project_untrusted`

#### Scenario: Trust service missing
- **WHEN** the host does not provide `host.isProjectTrusted`
- **THEN** every project is treated as untrusted and user templates still work

### Requirement: Template validation

A template SHALL be valid only if it is at most `maxTemplateBytes` (default 65536), is a regular file whose realpath is inside its source directory, has an expanded roster within `min(maxTeammates, configured maximum)`, has unique member names accepted by the core name rules, `notify.coalesceMs` within 0–10000 and well-typed fields. Unknown keys SHALL be ignored with a warning. Invalid templates SHALL be listed with stable error codes and SHALL NOT be startable.

#### Scenario: Roster too large
- **WHEN** members expand to 7 teammates and `maxTeammates` is 5
- **THEN** the template is `invalid` with error `roster_exceeds_max`

#### Scenario: Reserved member name
- **WHEN** a member is named `lead`
- **THEN** the template is `invalid` with error `name_reserved`

#### Scenario: Symlink escape refused
- **WHEN** `.pi/teams/x.md` is a symlink to a file outside `.pi/teams/`
- **THEN** it is listed `invalid` with error `outside_source_dir` and not read

#### Scenario: Coalesce bound
- **WHEN** `notify.coalesceMs` is 60000
- **THEN** the template is `invalid` with error `notify_out_of_range`

#### Scenario: Unknown key warns
- **WHEN** frontmatter has an unknown key `colour`
- **THEN** the template is valid and carries a warning naming `colour`

### Requirement: Template error codes and strict parsing

Validation failures SHALL use one stable code per cause: `template_too_large`, `name_invalid`, `frontmatter_invalid`, `field_invalid` (with the field path), `hook_command_too_long`, `duplicate_member` and `roster_name_invalid`. The frontmatter SHALL be parsed strictly, with no aliases, anchors, merge keys or custom tags and with unique keys. `count`, `maxTeammates` and hook `timeoutMs` SHALL be integers of at least 1.

#### Scenario: Oversize file
- **WHEN** a template file is 65537 bytes
- **THEN** it is listed `invalid` with `template_too_large` and its content is not read

#### Scenario: Bad template name
- **WHEN** the file `Abc.md` declares `name: Abc`
- **THEN** it is listed `invalid` with `name_invalid`

#### Scenario: Alias refused
- **WHEN** the frontmatter contains an anchor, an alias, a merge key or a custom tag
- **THEN** the template is `invalid` with `frontmatter_invalid` and parsing returns promptly

#### Scenario: Non-integer count
- **WHEN** a member declares `count: 1.5`, `count: 0` or `count: "2"`
- **THEN** the template is `invalid` with `field_invalid` and the path of that field

#### Scenario: Expanded name too long
- **WHEN** a 31-character member name has `count: 2`, so the expanded name exceeds the core 32-character rule
- **THEN** the template is `invalid` with `roster_name_invalid` and nothing is spawned

#### Scenario: Duplicate expanded names
- **WHEN** a roster has `style` with `count: 2` and a member `style-1`
- **THEN** the template is `invalid` with `duplicate_member`

### Requirement: Minimal template variables

The plugin SHALL substitute exactly `{{goal}}` and `{{cwd}}` by plain string replacement in the body and in each member `prompt`, once, without recursive expansion. An unknown `{{name}}` SHALL stay literal and produce a warning. The goal SHALL be required, at most 4000 characters and collapsed to one line (every control character, newline and tab included, becomes one space, then trimmed) and SHALL be non-empty afterwards.

#### Scenario: Goal substituted verbatim
- **WHEN** the goal is `fix {{cwd}}` and the body contains `{{goal}}`
- **THEN** the playbook contains the text `fix {{cwd}}` unchanged

#### Scenario: Empty goal rejected
- **WHEN** `team.start` is called with an empty goal
- **THEN** it fails with `invalid_args` and creates no team

#### Scenario: Whitespace-only goal
- **WHEN** `team.start` is called with the goal `"   "` or `"\t\n"`
- **THEN** it fails with `invalid_args` and creates no team

#### Scenario: Multi-line goal collapsed
- **WHEN** the goal is `line1` and `line2` separated by a newline
- **THEN** the playbook contains `line1 line2` on one line

#### Scenario: Goal over the limit
- **WHEN** the goal is 4001 characters
- **THEN** `team.start` fails with `invalid_args` and creates no team

### Requirement: Template is separate from runtime state

A template SHALL describe how to start a team only. At start the plugin SHALL persist a snapshot on the team (`template {name, source, hash}`, resolved hooks, overrides, plan-approval default, `defaultModel`, the validated member list, `goal`, playbook text) and read only the snapshot afterwards. Later edits or deletion of the file SHALL NOT change a running team.

#### Scenario: Edit after start
- **WHEN** a team is started from `review-pr` and the file is then edited
- **THEN** the running team keeps its original hooks and defaults

#### Scenario: Restart before bind keeps the roster
- **WHEN** the server restarts after `team.start` and before the lead binds, even if the template file was deleted
- **THEN** after the bind the eager members and the playbook mail come from the snapshot

#### Scenario: Lead-spawned roster member honours the snapshot
- **WHEN** the lead spawns a `spawn: lead` roster member after the template file was edited or deleted
- **THEN** that member's tools and skills ceiling and plan-approval floor come from the snapshot

#### Scenario: No pre-authored tasks
- **WHEN** a template without a registered start profile is started
- **THEN** the team has no tasks until the lead or a member creates them

### Requirement: Command start path

The bridge SHALL register the pi extension command `agent-team` with subcommands `start <template> <goal…>` and `templates`. `start` SHALL send `team.start` through the request lane, which makes the calling session the lead through the core `createTeam` and `bindLead` operations using the session's own cwd; the bridge SHALL then register the lead tool set exactly as after `TeamCreate`, deliver the playbook, and report every error through the session UI.

#### Scenario: Start from the command
- **WHEN** a plain session runs `/agent-team start review-pr "PR 123"`
- **THEN** a team exists with that session as lead, the lead tools are registered, the playbook arrives as an `agent-teams-playbook` message and the lead's turn starts

#### Scenario: Payload cwd ignored
- **WHEN** a `team.start` lane payload carries a `cwd`
- **THEN** the session record's cwd is used and the payload value is ignored

#### Scenario: Already in a team
- **WHEN** a lead session runs `/agent-team start x "g"`
- **THEN** the user sees `already_in_team` and no second team is created

#### Scenario: Confined session refused
- **WHEN** a session confined by another plugin runs `/agent-team start x "g"`
- **THEN** the user sees `lead_confined` and no team is created

#### Scenario: Lead model ignored
- **WHEN** the template sets `lead.model` and the command path is used
- **THEN** the session keeps its model and the user sees a notice that `lead.model` applies only to dashboard start

### Requirement: REST and dashboard start path

The plugin SHALL expose `GET /api/plugins/agent-teams/templates?cwd=` (tier `observe`) and `POST /api/plugins/agent-teams/teams/start {template, goal, cwd, trustHooks?}` (tier `operate`). `cwd` SHALL be required (`cwd_required`) and admitted through the host route-cwd admission. The start SHALL record `Team.owner` from the request principal when one exists.

#### Scenario: Start from the REST route
- **WHEN** a client posts a valid template, goal and admitted cwd
- **THEN** the server creates the team with `owner` set to the request principal and spawns a new lead session in that cwd

#### Scenario: cwd missing
- **WHEN** the body has no `cwd`
- **THEN** the route answers `cwd_required` and creates nothing

#### Scenario: Unknown cwd refused
- **WHEN** the REST body names a cwd the host does not admit
- **THEN** the route answers with the standard cwd refusal and creates nothing

#### Scenario: Starter sees its own team
- **WHEN** identity is enforced and a principal starts a team through the route
- **THEN** that principal can read the team through the owner-filtered read routes

#### Scenario: Double submit is not deduplicated
- **WHEN** two identical start requests arrive for the same cwd, template and goal
- **THEN** two teams are created up to `maxActiveTeams` and the next request is refused with `team_cap_reached`

### Requirement: Start team entry in the dashboard

The plugin SHALL claim the `sidebar-folder-section` slot to offer a Start team action per workspace folder, opening a dialog that lists the folder's templates with source, validity and trust state, takes a goal, and calls the start route with the folder cwd. A hook-confirmation step SHALL show the exact commands before a hash-bound confirmation.

#### Scenario: Start from the folder
- **WHEN** the user picks a valid template in a folder's dialog, enters a goal and confirms
- **THEN** the start route is called with that folder's cwd and the new lead session appears in the sidebar

#### Scenario: Hook confirmation step
- **WHEN** the start route answers `hooks_untrusted {hash, commands}`
- **THEN** the dialog lists the commands and retries with `trustHooks` equal to that hash only after the user confirms

#### Scenario: Untrusted project template
- **WHEN** a template is listed `trusted:false`
- **THEN** the dialog shows it disabled with a prompt to trust the project

### Requirement: Server-started lead

The server SHALL create the team with core `createTeam` in status `starting` (explicit `leadCwd`, `owner`) before any lead session exists, and spawn the lead with `pluginRef` `{"agent-teams": {teamId, role:"lead"}}` and the template `lead.model`. When the lead binds, the server SHALL deliver the playbook as a waking `playbook` mail and start eager members.

#### Scenario: Lead binds
- **WHEN** the spawned lead session binds through the core `bindLead` operation
- **THEN** the playbook mail wakes the lead and eager members start spawning

### Requirement: Lead bind deadline

The server SHALL persist the lead spawn token and a bind deadline of `spawnTimeoutMs`. At the deadline an unbound team SHALL be closed with reason `lead_spawn_failed` and the spawn aborted by token; the check SHALL be re-armed or applied at server start.

#### Scenario: Lead never binds
- **WHEN** the lead session does not register within `spawnTimeoutMs`
- **THEN** the team is closed with `lead_spawn_failed`, the spawn is aborted by its token and the REST caller can read the reason

#### Scenario: Restart before bind
- **WHEN** the server restarts while a team is `starting` and the lead never binds
- **THEN** after the persisted deadline the team is closed with `lead_spawn_failed` and holds no `maxActiveTeams` slot

#### Scenario: Restart with time left
- **WHEN** the server restarts before the deadline and the lead session re-binds
- **THEN** the team continues and eager members start after the bind

### Requirement: Playbook fits one mail

The rendered playbook (body, goal, roster summary and notes) SHALL fit one core mail: at most core `maxMessageChars` less 500 for the header, and 120 lines. A template whose body alone exceeds that SHALL be listed invalid with `playbook_too_long`; a start whose rendered playbook exceeds it SHALL fail `playbook_too_long` before any team is created. The playbook SHALL never be truncated. Characters and lines SHALL be counted with the core helper.

#### Scenario: Body over the mail cap
- **WHEN** a template body is 9000 characters
- **THEN** it is listed invalid with `playbook_too_long` and is not startable

#### Scenario: Goal pushes the playbook over
- **WHEN** a valid template and a 4000-character goal render to more than the cap
- **THEN** `team.start` fails with `playbook_too_long` and no team is created

#### Scenario: Counting follows core
- **WHEN** a playbook has a CRLF line break, a run of blank lines and an astral character
- **THEN** characters are counted as code points and lines by the core helper (CRLF one break, runs of blank lines collapsed), the same way as for a mail

### Requirement: Playbook message

The playbook SHALL be delivered as a message of mail kind `playbook` (customType `agent-teams-playbook`, registered through the core mail-kind registry) built with the core envelope helper, whose first body lines state the template name and the goal. The plugin SHALL claim `custom-entry-renderer` for `agent-teams-playbook` with a collapsed line showing template and goal.

#### Scenario: Card shows template and goal
- **WHEN** a playbook message is rendered collapsed
- **THEN** the row shows the template name and the goal from its first body lines without a request

#### Scenario: Same message on both paths
- **WHEN** a team is started by the command or by the REST route
- **THEN** the lead receives a `playbook` message with the same envelope kind and first lines

### Requirement: Member spawn mode

With `spawn: eager` (default) the server SHALL spawn every template member after the lead is bound, expanding `count` to `<name>` or `<name>-1…-n`, through the core `spawnMember` operation. With `spawn: lead` it SHALL spawn none and SHALL list the roster in the playbook for the lead to spawn with `TeammateSpawn`. A failed eager spawn SHALL mark only that member `failed`.

#### Scenario: Eager spawn with count
- **WHEN** a member `style` has `count: 2`
- **THEN** members `style-1` and `style-2` are spawned

#### Scenario: One spawn fails
- **WHEN** one of three eager spawns fails
- **THEN** that member is `failed`, the others continue and the lead gets a waking notice

#### Scenario: Eager is the default
- **WHEN** a template omits `spawn`
- **THEN** its members are spawned after the lead binds

#### Scenario: Unknown spawn value
- **WHEN** a template declares `spawn: bogus`
- **THEN** it is `invalid` with `field_invalid`

### Requirement: Roster cap, restart and failure notices

The template `maxTeammates` SHALL cap the total of roster and lead-spawned members, the configured maximum remaining the upper bound. After a server restart eager spawning SHALL reconcile idempotently: only snapshot members missing from the team are spawned, once, and the playbook is never re-sent. Spawn failures within one coalesce window SHALL give the lead one waking notice listing every failed member.

#### Scenario: Template cap covers lead-spawned members
- **WHEN** a template has `maxTeammates: 3`, two roster members and the lead spawns two more with `TeammateSpawn`
- **THEN** the first extra member is created and the second is refused with the core cap error

#### Scenario: Restart in the middle of eager spawning
- **WHEN** the server restarts after two of four eager members were spawned and the lead re-binds
- **THEN** members three and four are spawned once, members one and two are not spawned again and the playbook is not re-sent

#### Scenario: Many failures wake once
- **WHEN** five eager spawns fail within one coalesce window
- **THEN** the lead receives one waking notice listing all five members

### Requirement: Per-team overrides

The template fields `autoDispatch` and `notify {coalesceMs}` SHALL be stored in the core `Team.overrides`, `defaultTools` and `defaultSkills` in the core team defaults; `defaultModel` SHALL be kept in the template snapshot. Errors, shutdown rejections, plan requests, member deaths, spawn failures and direct messages SHALL keep waking the lead regardless of `notify`.

#### Scenario: Auto-dispatch off
- **WHEN** a team has `autoDispatch: false`
- **THEN** idle members are not handed unowned tasks by the dispatcher but may still claim them with `TaskUpdate`

#### Scenario: Coalesce override
- **WHEN** a team has `notify.coalesceMs: 500`
- **THEN** lead notices flush after 500 ms instead of the configured default

### Requirement: Mode gating

A template `mode` MAY be omitted, in which case the runtime SHALL resolve it. Availability MAY depend on the calling lead session, so the listing reflects the resolved mode for that caller. A declared `mode` that is not available in the core mode registry SHALL list the template with error `mode_unavailable`, and `team.start` for it SHALL fail with `mode_unavailable`.

#### Scenario: Unregistered mode
- **WHEN** a template declares `mode: in-process` and no such mode is registered
- **THEN** it is listed with error `mode_unavailable` and `team.start` fails with `mode_unavailable`

#### Scenario: Mode omitted
- **WHEN** a template has no `mode`
- **THEN** it is startable and the runtime default applies

### Requirement: Start is not an agent tool

The `team.start` operation and `trustHooks` SHALL be reachable only from the bridge command and the REST routes. The plugin SHALL NOT register an agent tool that starts a templated team or confirms hooks, and `team.start` SHALL be refused for any session that is already a lead or a member.

#### Scenario: Teammate cannot start
- **WHEN** a teammate's bridge sends `team.start`
- **THEN** the server answers `nested_team_forbidden`

#### Scenario: No start tool
- **WHEN** the lead lists its tools
- **THEN** none of them starts a template or accepts `trustHooks`
