## 0. Prerequisite

- [x] 0.1 Confirm `generalize-worktree-init-hook` is implemented/archived (provides init-status `hasHook`, hook schema, Initialize button). This change builds on it.

## 1. Project profiles (data)

- [x] 1.1 Create shipped profiles under `skills/project-init/profiles/`: `coding/` and `docs/`, each with `AGENTS.md.tmpl`, `settings.json.tmpl` (containing a valid change-A `worktreeInit` hook + toolset toggles), and `prompts/*.md`.
- [x] 1.2 `coding` profile: TDD/simplicity/surgical AGENTS.md; `worktreeInit` gate `test ! -d node_modules` + `npm ci`; OpenSpec enabled.
- [x] 1.3 `docs` profile: writing-structure AGENTS.md; appropriate hook (no-op gate or docs build); OpenSpec disabled, docs toolset.
- [x] 1.4 Profile resolver: enumerate `<skill>/profiles/*` ∪ `~/.pi/project-profiles/*`, user-wins-by-name. Unit-test the merge precedence.

## 1b. DOX doctrine artifact + seed-if-absent

- [x] 1b.1 Add `skills/project-init/dox-doctrine.md` — one canonical doctrine covering WRITE discipline (adapted from agent0ai/dox: read-before-editing chain walk, update-after-editing pass, hierarchy, child-doc shape, closeout) AND a READ discipline "Finding docs" section. Under a kb-indexed path so `kb_search "dox doctrine"` returns it.
- [x] 1b.1a Read section is toolset-conditional: kb-wired variant instructs `kb agents <path>` + `kb_search` before grepping; kb-absent variant uses manual chain-walk wording with no `kb_search`/`kb agents` reference. → verify: unit test asserts kb-wired seed contains `kb_search`, kb-absent seed does not.
- [x] 1b.2 Add an optional `dox: boolean` flag to the profile shape (default `false`); resolver surfaces it. Unit-test default + explicit `true`.
- [x] 1b.3 Seed step: given a DOX-opted profile, detect a stable marker (e.g. `<!-- dox-doctrine -->`) in the target `AGENTS.md`; append `dox-doctrine.md` (with the marker) only when absent. Idempotent. → verify: unit test asserts absent→seeded-once, present→no-op, re-run→no double-seed.
- [x] 1b.4 DOX-opted `settings.json.tmpl` sets `indexAgentsFiles: true` + `directoryLevelAgents.enabled: true`. → verify: rendered settings validate against the kb config schema.

## 2. project-init skill

- [x] 2.1 Author `skills/project-init/SKILL.md`: interactive flow — list profiles, `ask_user` to select, preview planned writes, confirm, scaffold. When the chosen profile opts into DOX, the preview SHALL name the doctrine seed + toolset flip.
- [x] 2.2 Scaffold step writes `<dir>/AGENTS.md`, `<dir>/.pi/settings.json` (with `worktreeInit` + toolset), prompt files, and — for a DOX-opted profile — the seeded doctrine block (task 1b.3) from the chosen profile.
- [x] 2.3 Validate the written `worktreeInit` against change-A schema before finishing; warn if it would fail-open.
- [x] 2.4 Idempotency note: if files already exist, ask before overwriting.

## 3. Polymorphic Initialize button (client)

- [x] 3.1 In folder-action-bar / `WorktreeSpawnDialog`, when init-status reports `hasHook: false`, show the Initialize button and route its click to spawn an interactive project-init session (cwd = the directory), reusing the existing spawn-session machinery with the skill pre-injected.
- [x] 3.2 When `hasHook: true`, defer to change-A behavior (no change here).
- [x] 3.3 Component tests: no-hook row shows Initialize → spawns project-init session; hook row keeps change-A behavior.

## 4. Profile enumeration surface (if needed)

- [x] 4.1 Decide skill-side fs read vs a server endpoint to list profiles; implement the chosen path.
- [x] 4.2 Tests for profile listing (shipped + user override).

## 5. Docs + validation

- [x] 5.1 Add file-index rows for the new skill + profiles + `dox-doctrine.md` (delegate to docs subagent, caveman style).
- [x] 5.2 `openspec validate project-init-skill-and-profiles --strict` passes.
- [x] 5.3 `npm test` green (one pre-existing unrelated env failure in `tool-registry/node-electron-resolution` + pre-existing SessionCard biome flags — neither touched by this change); all new project-init/registry/component tests pass. Manual smoke (bare dir → Initialize → pick profile → scaffold → hasHook flip → hook runs) pending a live dashboard run.
