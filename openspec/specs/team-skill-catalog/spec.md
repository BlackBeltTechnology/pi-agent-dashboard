# team-skill-catalog Specification

## Purpose
TBD - created by archiving change add-team-skill-access. Update Purpose after archive.

## Requirements

### Requirement: Catalog entry shape

The team skill catalog SHALL map a name to an entry `{ path, users, targets }`. The name SHALL be a valid pi skill name (`[a-z0-9-]`, 1–64 characters, no leading, trailing or consecutive hyphen) and SHALL equal the `name` that pi resolves for the skill at `path` (its `SKILL.md` frontmatter `name`, else its directory name). The entry fields are:
- `path` is an absolute path.
- `users` is `"*"` or a list of `{ iss, sub }`.
- `targets` is `"*"` or a list of project ids and `_ws`.

A config value that is a plain string SHALL be read as `{ path: <string>, users: "*", targets: "*" }`. A missing `users` or `targets` SHALL be read as `"*"`.

A skill SHALL be allowed for a caller in a target when both hold:
- users: the plugin runs in single-user mode, or `users` is `"*"`, or `users` lists the caller's `(iss, sub)`;
- targets: `targets` is `"*"` or lists the target.

#### Scenario: Legacy string entry
- **WHEN** config has `skillCatalog: { "review": "/opt/skills/review" }`
- **THEN** `review` is allowed for every user in every target

#### Scenario: Target-scoped entry
- **WHEN** `review` has `targets: ["billing"]`
- **THEN** it is allowed in `billing` and not in `crm` or `_ws`

#### Scenario: Single-user ignores users
- **WHEN** the plugin runs in single-user mode and `review` has `users: [{ iss: "x", sub: "bob" }]`
- **THEN** `review` is allowed for the local operator in its targets

### Requirement: Config and managed entries

When a name exists in both sources, the config entry SHALL win, and the managed entry SHALL be listed as invalid with `invalidReason: "shadowed_by_config"`. The catalog SHALL be the union of config entries (`skillCatalog` in the plugin config) and managed entries (stored atomically in `<teamHome>/skills.json` with `schemaVersion: 1`).

An admin in multi-user mode, or the operator in single-user mode, SHALL be able to:
- create a managed entry with `POST /api/plugins/team/skills`;
- edit `path`, `users` and `targets` with `PATCH /api/plugins/team/skills/:name`;
- remove it with `DELETE /api/plugins/team/skills/:name`.

Any other caller SHALL get `403`. Creating a name that exists in either source SHALL answer `409 skill_exists`, also when two creates race. Managed writes SHALL be serialised so exactly one of them succeeds. Editing or removing a config entry SHALL answer `409 skill_readonly`. A managed file that is unreadable or has an unknown `schemaVersion` SHALL be ignored and logged, and the plugin SHALL keep running. In that state the admin listing SHALL report `managedLoadError`, and managed writes SHALL answer `503 skill_store_unavailable` without touching the file.

#### Scenario: Admin adds a managed entry
- **WHEN** an admin posts `{ name: "review", path: "/opt/skills/review", users: "*", targets: ["billing"] }`
- **THEN** `skills.json` contains it and `GET /api/plugins/team/skills` lists it as `managed`

#### Scenario: Non-admin refused
- **WHEN** a non-admin posts a new skill entry in multi-user mode
- **THEN** the response is `403` and nothing is written

#### Scenario: Config entry is read-only
- **WHEN** an admin deletes a skill defined in config
- **THEN** the response is `409 skill_readonly`

### Requirement: Skill path validation

A skill `path` SHALL be absolute, at most 512 bytes, and SHALL resolve through `realpath` to a directory that contains a regular `SKILL.md`. A single-file skill SHALL be rejected. A path whose resolved skill name differs from the catalog name SHALL be rejected with `400 invalid_skill` and `fields.name = "name_mismatch"`. The resolved path SHALL NOT lie inside the team home or any project root, and SHALL NOT contain the team home, any project root, the pi agent directory, the host sessions root or the dashboard home. A write with an invalid path SHALL answer `400 invalid_skill` without storing it.

The path SHALL be validated again on every spawn or resume. An entry that no longer validates SHALL be logged without its path and treated as not allowed.

The skill root SHALL be the resolved directory.

#### Scenario: Ancestor of a project refused
- **WHEN** projects live under `/data` and an admin posts a skill whose path is `/data`
- **THEN** the response is `400 invalid_skill`

#### Scenario: Ancestor of the agent dir refused
- **WHEN** an admin posts a skill whose path is `~/.pi`
- **THEN** the response is `400 invalid_skill`, because it contains the pi agent directory and every session transcript

#### Scenario: Path inside a project refused
- **WHEN** an admin posts a skill whose path resolves inside project `billing`
- **THEN** the response is `400 invalid_skill`

#### Scenario: Name must match the skill
- **WHEN** an admin posts `{ name: "review", path: "/opt/skills/code-review" }`, and that `SKILL.md` declares `name: code-review`
- **THEN** the response is `400 invalid_skill` with `fields.name = "name_mismatch"`

#### Scenario: Concurrent duplicate create
- **WHEN** two admins post the same new name at the same time
- **THEN** one gets `201`, the other gets `409 skill_exists`, and `skills.json` holds one entry

#### Scenario: Path removed after grant
- **WHEN** a granted skill's directory is deleted and alice opens a conversation with a persona that lists it
- **THEN** the response is `409 skill_not_allowed` and the log names the skill but not its path

### Requirement: Catalog listing and available skills

`GET /api/plugins/team/skills` SHALL list the entries visible to the caller:
- For admins: every entry with `name`, `source` (`config`|`managed`), `path`, `users`, `targets`, `valid`, a `invalidReason` when invalid (including `name_mismatch`), and usage counts `{ personas, liveSessions }`.
- For others: only the entries allowed for them in at least one of their allowed targets, with `name`, `description` and `targets` limited to the caller's allowed targets.

`GET /me` SHALL return `skills` as those same caller-visible names. `GET /api/plugins/team/skills/available` (admin or operator only, `403` otherwise) SHALL list the operator's global skills (the agent-dir skills and the skills of global-settings packages) with `name`, `description`, `path` and `source`, and SHALL never list project-local skills. When the host does not provide this list, it SHALL answer `[]`. Descriptions SHALL come from `SKILL.md` frontmatter; an entry whose `SKILL.md` cannot be read SHALL be listed as `valid: false` without a description.

#### Scenario: Non-admin listing filtered
- **WHEN** `review` has `targets: ["crm"]` and alice is allowed only on `billing`
- **THEN** alice's `GET /api/plugins/team/skills` and `GET /me` do not include `review`

#### Scenario: Available list excludes project skills
- **WHEN** the dashboard knows a folder with `.pi/skills/local-x/SKILL.md` and an admin opens the available list
- **THEN** `local-x` is not listed

#### Scenario: Available list is admin-only
- **WHEN** a non-admin calls `GET /api/plugins/team/skills/available`
- **THEN** the response is `403`

### Requirement: Catalog change ends affected sessions

After a successful managed edit or remove, the plugin SHALL end every live team session whose persona lists the skill and for which the skill became denied for the session's caller and target, was removed, or resolves to a different root. It SHALL do so even when the session is streaming, without waiting for the turn to finish, and every affected session SHALL be ended within 5 seconds of the write's successful response. Only the server SHALL run this pass, as a consequence of an admin catalog write; no ensure, resume or restart route SHALL end another user's session, and each ended session SHALL be audit-logged with the admin and the affected user key. It SHALL NOT end a session whose grant is unchanged, where a changed root means a different `realpath`. `POST /api/plugins/team/skills/:name/impact` with a JSON body `{path?, users?, targets?, remove?}` (admin or operator only) SHALL report, without writing or ending anything, the sessions and personas a proposed edit or removal would affect: `{ endSessions, blockedPersonas: [{key, name, lostTargets}], otherUsersPrivate }`. It SHALL keep the conversation records, and it SHALL log `team.skill_invalidated` with the skill name and the number of sessions ended, without paths or principals. The next open of such a conversation SHALL resume with the current catalog, subject to the start check.

Config entries SHALL take effect at the next open of a conversation; the plugin is not required to observe config-file edits while a session stays open.

#### Scenario: Narrowing ends live sessions
- **WHEN** alice's conversation with a persona listing `review` is live in `billing`, and an admin removes `billing` from `review`'s targets
- **THEN** that session is ended within 5 seconds, alice's conversation record is kept, and her next open answers `409 skill_not_allowed`

#### Scenario: Impact preview is a dry run
- **WHEN** an admin posts `{ targets: ["crm"] }` to `/api/plugins/team/skills/review/impact` while two sessions using `review` in `billing` are live
- **THEN** the response reports `endSessions: 2` and lists every persona that would lose `billing`, and nothing is written or ended

#### Scenario: Path change restarts
- **WHEN** an admin changes `review`'s path while a session using it is live
- **THEN** that session is ended, and the next open spawns with the new path

#### Scenario: Widening keeps sessions
- **WHEN** an admin adds `crm` to `review`'s targets while alice's `billing` session using `review` is live
- **THEN** her session keeps running

#### Scenario: Config edit applies at next open
- **WHEN** the operator removes `review` from the config file while alice's session using it is live, and alice then reopens the conversation
- **THEN** the reopen ends the live session and answers `409 skill_not_allowed` with `reason: "missing"`

### Requirement: Skill state in agent listings

Each persona item of `GET /api/plugins/team/agents?project=` SHALL carry `effectiveSkills` (the persona's skill names, which the caller may use in that target) and `skillBlock`, which is `null` or `{ skill, reason }` computed with the same rules and order as the spawn check. A persona with a non-null `skillBlock` SHALL report status `unavailable`. The listing SHALL NOT include skill paths.

#### Scenario: Blocked persona visible before opening
- **WHEN** `shared:elemzo` lists `legacy-lint`, whose path no longer validates, and alice lists agents in `billing`
- **THEN** its item has `skillBlock: { skill: "legacy-lint", reason: "invalid" }` and status `unavailable`

#### Scenario: Effective skills listed
- **WHEN** `shared:backend` lists `review` and `openspec-propose`, both allowed for alice in `billing`
- **THEN** its item has `effectiveSkills: ["review", "openspec-propose"]` and `skillBlock: null`

### Requirement: Catalog observability

Every catalog write SHALL be logged as `team.skill_write op=<create|update|delete> name=<n> by=<uk>`. Every batch of sessions ended by a catalog change SHALL be logged as `team.skill_invalidated name=<n> sessions=<k>`. Every spawn refused for a skill SHALL be logged as `team.skill_not_allowed name=<n> uk=<uk> target=<t> reason=<missing|invalid|users|targets>`. Neither log line SHALL contain a path or skill content.

#### Scenario: Refusal logged
- **WHEN** a spawn is refused because `review` is not allowed in the target
- **THEN** the log has `team.skill_not_allowed name=review … reason=targets` and no path
