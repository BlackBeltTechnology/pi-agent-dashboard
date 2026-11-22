# Auto-seed pi project defaults into every folder the dashboard knows about

## Why

A directory the dashboard knows about renders as **"not initialized"** whenever
it carries no `.pi/settings.json`. The probe that decides this is
`buildSetupChecklist()` in `packages/server/src/routes/git-routes.ts`: a
five-artifact `stat` at the resolved config root (`settings` required; `agents`,
`prompts`, `openspec`, `kb` optional).

The only thing that ever wrote those artifacts was the **interactive**
`project-init` skill — a session the user must start, pick a profile in, and
confirm. Consequence in practice: on this host ~400 directories under
`~/Project`, of which **8** carry `.pi/settings.json` + `.pi/dashboard/knowledge_base.json`.
Every other pinned folder shows the "not initialized" affordance forever, and
none of them gets the `worktreeInit` hook, the directory-level AGENTS.md kb
toolset, or the per-project prompts — the whole reason those defaults exist.

Pinning a folder is already an explicit statement of intent ("this is a project
I work on"). That is the moment to give it the defaults, without a prompt.

## What Changes

- **New `packages/server/src/project-seed.ts`**. `seedProjectDefaults(dir)`
  resolves the CONFIG ROOT (`resolveConfigRoot` — the same root the checklist
  stats, so every worktree of one repo collapses to a single seed), detects the
  stack (`detect-stack.ts`), resolves the shipped **`coding`** profile
  (`stackAware` + `dox`), and scaffolds it **gap-fill only**. Exports
  `scheduleProjectSeed` (deferred one tick), `sweepKnownProjects` (boot sweep)
  and `configureProjectSeed` (the config switch).
- **Non-destructive by construction.** `scaffoldProfile` gains a
  `skipExisting` mode: write only the ABSENT artifacts, never throw on a
  conflict, and append the DOX doctrine block only to an `AGENTS.md` the call
  itself created. A pre-existing `AGENTS.md` / `settings.json` stays
  byte-identical.
- **Refusals**: a path that is not a directory, `$HOME`, a filesystem root. A
  per-process `Set` of seeded config roots makes repeat triggers free; every
  failure is swallowed into the outcome so a pin / session registration can
  never fail because of seeding.
- **Inert hook when the stack is unknown.** An unfilled `{{INIT_GATE}}` would
  be persisted as a literal gate, so a no-stack directory gets
  `gate: "false"` / `command: "true"` — structurally valid, and `evaluateGate`
  reports `needsInit: false`, so nothing ever runs.
- **Three trigger points**: `pinDirectorySideEffects` (folder pinned or ejected
  into the sidebar), `piGateway.onSessionRegistered` (a session's cwd), and a
  boot sweep in `createServer` over pinned dirs ∪ workspace folders. Each
  directory is deferred onto its own tick, because the config-root probe spawns
  git synchronously and a large pin list must not stall startup.
- **`DashboardConfig.autoSeedProjects`** (default `true`) turns the whole thing
  off, restoring the interactive-skill-only behaviour.
- **`packages/extension/package.json` gains an `exports` map**
  (`./package.json` + `./*.js` → `./src/*.ts`, mirroring `pi-dashboard-shared`)
  so the server — which already depends on the extension package — can import
  the `project-init` core instead of duplicating it.

## Capabilities

### Modified Capabilities

- `project-init-skill`: adds an unattended server-side seeding Requirement
  alongside the existing interactive skill, and a gap-fill Requirement for the
  scaffold.
- `folder-action-banner`: a folder the dashboard knows about no longer reports a
  missing `settings` artifact once the seed has run.

## Impact

- **A fully configured project costs one `existsSync` fan-out.** The
  `isFullySeeded` short-circuit runs before the profile machinery on every
  trigger, and the memo means the git probe happens at most once per config
  root per process.
- **Files appear in user repos.** This is the point of the change, but it is a
  write into a git working tree: the seeded `AGENTS.md` / `.pi/` will show up as
  untracked in `git status`. `autoSeedProjects: false` is the escape hatch.
- **A user profile still wins.** `resolveProfiles()` overlays
  `~/.pi/project-profiles/coding` over the shipped one, so the seeded defaults
  are customizable per host without touching the dashboard.
- **Out of scope**: seeding `openspec/` (the fifth checklist artifact — it needs
  `openspec init`, which is a separate affordance), overwriting or migrating an
  existing `.pi/settings.json`, and any UI for reviewing what was seeded.

## Discipline Skills

- `doubt-driven-review` — the change writes files into arbitrary user git
  repositories unattended. The refusal list (`$HOME`, filesystem root,
  non-directory), the byte-identical guarantee for pre-existing files, and the
  inert no-stack hook are all outcomes of that pass and must stay covered by
  tests.
- `security-hardening` — the seeded `worktreeInit` hook is a shell command the
  Initialize button later runs. Stack commands are fixed constants from
  `STACKS` and substituted values are JSON-escaped before the rendered
  `settings.json` is parse-validated, so a project name or command containing
  `"` / `\` cannot corrupt the file into an attacker-chosen hook.
- `observability-instrumentation` — an unattended writer needs a trace: each
  seeding run that actually wrote something logs `[project-seed] seeded <root>
  (<n> file(s))`; a steady-state boot logs nothing.
