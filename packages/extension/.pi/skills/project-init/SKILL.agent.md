# SKILL.md — project-init index

Pull-only condensed map. Source: packages/extension/.pi/skills/project-init/SKILL.md. Scaffold unconfigured dir into configured pi project; interactive, profile-driven, preview before write.

Triggers: "create project", bare dir, dashboard "Initialize" button spawns session. Target = cwd. `<skill>` = this skill dir.

## Step 1 — Profiles
- Sources (user wins by name): `<skill>/profiles/*`, `~/.pi/project-profiles/*`.
- Usable only if both `AGENTS.md.tmpl` + `settings.json.tmpl` exist.
- `profile.json`: `description`, `dox` (default false), `stackAware`.
- Shipped: `coding` (TDD/simplicity/surgical, OpenSpec on, `npm ci`), `docs` (OpenSpec off, no build).

## Step 2 — Select profile
- `ask_user` select.

## Step 2b — Stack (stackAware only)
- Placeholders: `{{INSTALL_CMD}}`, `{{TEST_CMD}}`, `{{BUILD_CMD}}`, `{{INIT_GATE}}`, `{{INIT_COMMAND}}`.
- Marker → stack: `pnpm-lock.yaml`→pnpm, `yarn.lock`→yarn, `bun.lock(b)`→bun, `package-lock.json`/`package.json`→npm, `Cargo.toml`→cargo, `go.mod`→go, `poetry.lock`→poetry, `requirements.txt`/`pyproject.toml`→pip, `pom.xml`→maven, `build.gradle(.kts)`→gradle.
- JS lockfile beats bare `package.json`. No guess on bare dir.
- Confirm via `ask_user`. Never scaffold stackAware without resolved stack.
- Post-write: no `{{…}}` left in `AGENTS.md` or `.pi/settings.json`.

## Step 3 — Optional capabilities + preview
### 3a DOX
- `ask_user` confirm; default = profile `dox`. Answer → `DOX_ENABLED`.
### 3b OpenSpec (coding only) → `OPENSPEC_MODE`
- Config `~/.pi/dashboard/config.json` `openspec`: `enabled`, `offerInitialization` (default true), `optOutDirectories` (default []).
- Unreadable/invalid JSON or wrong types → fail closed → `skip`.
- Opt-out match: pathKey = resolve, `/` separators, strip trailing `/`, lowercase unless linux.
- Git placement fail-closed: linked worktree or subdir of checkout → `skip`.
- First match wins:
  1. config undeterminable → `skip`
  2. `enabled===false` or opt-out match → `skip`
  3. git placement skip → `skip`
  4. no `./openspec/` AND `offerInitialization===false` → `skip`
  5. no `./openspec/` → `offer` (confirm; runs `openspec init --tools pi --force`)
  6. `./openspec/` present, `.pi/skills/openspec-explore/` absent → `repair` (no question; preview confirm = overwrite confirm)
  7. both present → `skip`
- Legacy artifacts (offer/repair only): root `CLAUDE.md`, `AGENTS.md`, etc. only if `<!-- OPENSPEC:START/END -->` present; `.claude/commands/openspec`, `.cursor/commands`, `.codex/prompts`, etc. Disclose by path.
### 3c Preview writes
- `./AGENTS.md` ← `AGENTS.md.tmpl` (`{{PROJECT_NAME}}` = basename)
- `./.pi/settings.json` ← `settings.json.tmpl`
- `./.pi/prompts/*.md` ← `prompts/`
- DOX: pointer block in AGENTS.md; `./.pi/dashboard/knowledge_base.json` doctrine flip.
- OpenSpec: `openspec init --tools pi --force`; overwrite `./.pi/skills/openspec-*`; may remove legacy files; may touch `~/.config/openspec`.
- coding: may `pi install` eng-disciplines user-global (`~/.pi/agent/settings.json`), opt-in.
- Last: names Step 4c as a separate opt-in question (not a write).
- Idempotency: ask before overwriting existing `AGENTS.md` / `.pi/settings.json`.

## Step 4 — Write
- Validate `worktreeInit`: `gate` non-empty string; `run` = `{type:"script",command}` or `{type:"agent",prompt}` non-empty. Invalid → warn (fails open).

## Step 4b — Discipline skills (coding only)
- Detect: `pi list | grep pi-dashboard-eng-disciplines` or stat `~/.pi/agent/npm/node_modules/@blackbelt-technology/pi-dashboard-eng-disciplines`.
- PRESENT → skip prompt; remove stale "not detected" footnote.
- ABSENT → confirm; yes → `pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines`; no/fail → append footnote under `## Discipline Skills`: "Discipline skills not detected — run `pi install npm:…` to activate the checkpoints above."

## Step 4c — Folder access (separate opt-in; never fails init)
- After scaffold, all profiles. Own `ask_user` confirm; declined → submit nothing.
- Lines: `./.pi/access.json` (v1 only; unknown version refused) else user lists folders; none → skip.
- Submit via `project-access` `provision`; report each line outcome.
- Refused/expired/dismissed/unreachable → report, init continues. `no-operator` → open dashboard, retry later with `project-access`. Never call settle routes.

## Step 5 — DOX seed (only if DOX_ENABLED)
- Append marker block `<!-- dox-doctrine -->` to AGENTS.md unless marker present. No doctrine copied.
- `knowledge_base.json`: set only `doctrine: {inject:"kb", write:true}`. Absent file → full default: `sources` `[{kind:"filesystem",ref:"."}]`, `indexAgentsFiles:true`, `directoryLevelAgents:{enabled:true}`, plus doctrine.
- Run `kb dox init`.
- Offer `dox-describe` (≤50 rows/run, one subagent per AGENTS.md).

## Step 6 — OpenSpec init (repair, or offer confirmed)
- Run `openspec init --tools pi --force`.
- Verify exit 0, `.pi/skills/openspec-explore/` exists (+ `./openspec/` for offer).
- Failure → warn, `ls .pi/skills`, manual cmd. Do not error.
- Re-run after success → skip.

## Step 7 — Done
- `worktreeInit` written → Initialize button runs hook instead of this skill.
