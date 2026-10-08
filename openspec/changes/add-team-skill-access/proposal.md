## Why

Team personas cannot use skills in practice. Three problems cause this:

- **No way to configure them.** The admin skill catalog (`skillCatalog`: name → absolute path) exists only as a hand-edited config map. The persona editor hides the Skills field while the catalog is empty, so users never see it.
- **Granted skills cannot be read.** A skill is used by `read`ing its `SKILL.md`, but the team guard blocks every file-tool call outside the target root (`path_outside_root`). Catalog skills always live outside the root.
- **Admin control has no effect.** Team spawns do not pass `--no-skills`, so every persona session also loads every global and package skill on the host. Skills added by extensions through `resources_discover` (for example `pi-hermes-memory`) get past `--no-skills` entirely. In multi-user mode this shows the operator's skill names and descriptions in every persona prompt, and any team user can expand the full text of an operator skill with `/skill:<name>`.

Admins need to decide which skills each user can use in each workspace or project, and that decision must actually be enforced.

## What Changes

- **Catalog entries gain access scope.** Each catalog name must equal the skill's own pi name, and each path must be a directory containing `SKILL.md`. Each `skillCatalog` entry becomes `{ path, users: "*" | [{iss, sub}], targets: "*" | [projectId | "_ws"] }`. A legacy string value means `{ path, users: "*", targets: "*" }`. In single-user mode `users` is ignored.
- **Admin-managed catalog.** Config entries stay read-only (`409 skill_readonly`). Admins (the operator in single-user mode) can add, edit and remove further entries through new `/api/plugins/team/skills` routes. These entries are stored atomically in the team home, using the same pattern as folder-enabled projects. New entries are picked from the skills the host already discovers.
- **Strict persona validation.** When a persona is saved, every skill it lists must be allowed for every target in its `projects`. A private persona's skills must also be allowed for its owner. Otherwise the save is rejected with `400 invalid_persona` (`fields.skills = "skill_not_allowed"`). A fork keeps only the skills allowed for the forking user and for the fork's projects.
- **Start check on every open.** Every open (create, resume, and reuse of a live session) is refused with `409 skill_not_allowed` `{skill, reason}` when any persona skill is not allowed for the caller and target at that moment. Nothing is spawned, and a reused live session is ended.
- **Exact skill set.** Team spawns always pass `--no-skills`, plus one `--skill <path>` for each effective skill. **BREAKING (behavioral):** personas no longer receive global or package skills by accident.
- **Guard grants read access to skills.** The guard policy carries the effective skills' roots. `read`, `grep`, `find` and `ls` are allowed inside a skill root; `write` and `edit` stay blocked there.
- **Bridge expands only granted skills in team sessions.** Today the dashboard bridge silently drops a single-line `/skill:` in team sessions, and it expands a multi-line `/skill:x` from disk and from pi's whole command registry. That is a second leak path: it exposes extension-discovered skills and global prompt templates, and it bypasses project trust. In team sessions the bridge now:
  - expands a `/skill:` only for effective skills, from their own `SKILL.md`, using the existing `buildSkillBlock` envelope;
  - refuses any other `/skill:` before it is queued;
  - sends all other `/` text through unexpanded.

  A single shared `parseSkillCommand` is used by the composer, the bridge and the guard.
- **Guard hides leaked skills.**
  - A `before_agent_start` hook removes every skill outside the effective set from the system prompt.
  - An `input` hook refuses `/skill:<name>` for any name outside the effective set.
  - Together they close the leak through `resources_discover`.
- **Managed catalog changes take effect immediately.** A managed edit or removal that revokes a skill, or changes its path, ends the live persona sessions it affects, even mid-turn. Widening ends nothing. Conversation records are kept, and the next open resumes with the current set or answers `409 skill_not_allowed`. Config-file edits take effect at the next open, because the plugin receives no config-change notification.
- **UI.**
  - A Team admin "Skills" panel lists, adds and edits entries, and sets their users and targets.
  - The persona editor offers only skills allowed for the persona's selected targets.
  - When the catalog is empty, admins see a hint instead of a hidden field.

Mockup: mockups/ (in this change). See `mockups/ui-plan.md`; probe at `mockups/ux-probe.cjs`.

## Capabilities

### New Capabilities
- `team-skill-catalog`: admin-managed, access-scoped skill catalog. Covers entry shape, config vs managed entries, path validation, CRUD routes, discovery source, and session invalidation when the catalog changes.

### Modified Capabilities
- `team-personas`: "Skills come from an admin catalog" now requires each skill to be allowed for the persona's targets (and for the owner, on private personas).
- `team-agent-sessions`:
  - "Persona injection per turn" now spawns with `--no-skills` and the effective skills, and adds the `409 skill_not_allowed` spawn check.
  - "Tool presets and file confinement" adds read-only skill roots, prompt filtering of skills and `/skill:` refusal.
- `bridge-prompt-expansion`: "Template and Skill File Resolution" now forbids disk and registry expansion in team sessions and allows only effective skills.
- `command-routing`: "Command routing order" gains a team-confined carve-out: `/skill:` handling first; only `/compact` and unexpanded passthrough otherwise; no extension dispatch, bash or exec templates.
- `bridge-extension`: "Skill command intercepts and injects SKILL.md" does not apply in team sessions (no registry lookup, no send-as-is fallback); "Command routing in send_prompt handler" defers to the `command-routing` team carve-out.
- `team-app`: "Persona editor" filters skills by target and shows the empty-catalog hint. A new requirement adds the admin Skills panel.

## Impact

- **Code:**
  - `packages/team-plugin/src/server/` (`persona.ts`, `personas-service.ts`, `conversations.ts`, `team.ts`, `routes.ts`, `types.ts`, new `skills-service.ts`)
  - `packages/team-plugin/src/extension/` (`guard.ts`, `index.ts`)
  - `packages/team-plugin/src/configSchema.json`
  - `packages/extension/src/` (`command-handler.ts`, `prompt-expander.ts` call sites: team-session skill route)
  - `packages/server/src/server.ts` (new `host.listOperatorSkills` plugin service)
  - `packages/team-app/src/` (`PersonaEditor.tsx`, new admin Skills panel, `api/`, i18n)
- **API:** new `GET|POST /api/plugins/team/skills`, `PATCH|DELETE /api/plugins/team/skills/:name`, `POST /api/plugins/team/skills/:name/impact` (dry run) and `GET /api/plugins/team/skills/available` (admin only). `GET /me` keeps `skills` but returns only the names the caller is allowed to use; the non-admin `GET /skills` adds descriptions and the caller-visible targets. `GET /agents` items gain `effectiveSkills` and `skillBlock`.
- **Compatibility:** a legacy `skillCatalog` string map keeps working **when each key equals the skill's own pi name**. A key that aliases a differently named skill, or that points at a single-file skill, becomes invalid (flagged in the Skills panel, listed in the CHANGELOG). When config and managed entries share a name, config wins. Persona files are unchanged. Personas that worked only because global skills leaked in lose those skills. Record this in the CHANGELOG.
- **Migration:** none for stored data. The new team-home `skills.json` is created on the first admin write.
- **Rollback:** revert the plugin. `skills.json` becomes unused, and the legacy map still works.
- **Upstream:** file a pi issue so that `--no-skills` also gates skills added through `resources_discover`. The guard hooks stay as defense in depth either way.

## Discipline Skills

- `security-hardening`: untrusted multi-user input reaches skill text and the guard's path confinement, so the leak and grant paths need it.
- `doubt-driven-review`: the behavioral break (`--no-skills` on every team spawn) and the guard's prompt rewrite need review before they stand.
- `observability-instrumentation`: new admin routes and the `skill_not_allowed` refusals need structured log lines.
