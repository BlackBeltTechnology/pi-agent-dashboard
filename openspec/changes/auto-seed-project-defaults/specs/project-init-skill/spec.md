# project-init-skill — delta

## ADDED Requirements

### Requirement: Server seeds project defaults unattended

The dashboard server SHALL seed the shipped `coding` profile's artifacts into
every directory it learns about, without user interaction, when
`DashboardConfig.autoSeedProjects` is `true` (the default). Seeding SHALL be
triggered when a directory is pinned into the sidebar, when a session registers
a cwd, and once at boot for the pinned directories and workspace folders already
in preferences. Seeding SHALL be keyed by the resolved CONFIG ROOT, so every
worktree of one repository seeds that repository once.

#### Scenario: A bare pinned directory gains every artifact

- **GIVEN** a directory with no `AGENTS.md` and no `.pi/`
- **WHEN** the directory is pinned
- **THEN** `AGENTS.md`, `.pi/settings.json`, `.pi/prompts/*.md` and
  `.pi/dashboard/knowledge_base.json` SHALL be written
- **AND** the init-status checklist SHALL no longer report `settings` absent

#### Scenario: Seeding is idempotent

- **GIVEN** a directory already seeded in this process
- **WHEN** seeding is triggered again for it or for one of its worktrees
- **THEN** no file SHALL be written
- **AND** no git probe SHALL be spawned for it a second time

#### Scenario: Seeding is disabled by configuration

- **GIVEN** `autoSeedProjects` is `false`
- **WHEN** any trigger point fires
- **THEN** no file SHALL be written and the outcome SHALL report `disabled`

#### Scenario: Refused targets

- **WHEN** the resolved root is `$HOME`, a filesystem root, a path that does not
  exist, or a file
- **THEN** nothing SHALL be written
- **AND** the outcome SHALL carry the refusal reason

#### Scenario: A seeding failure never fails its trigger

- **WHEN** seeding throws for any reason
- **THEN** the error SHALL be swallowed into the returned outcome
- **AND** the pin / session registration that triggered it SHALL complete
  normally

### Requirement: Unattended seeding never modifies an existing file

Unattended seeding SHALL write only the artifacts that are ABSENT. Every file
already on disk SHALL remain byte-identical — including `AGENTS.md`, which SHALL
NOT receive the append-only DOX doctrine block unless the seeding run created
that file itself.

#### Scenario: Half-configured project is gap-filled

- **GIVEN** a directory with a user-authored `AGENTS.md` and `.pi/settings.json`
- **WHEN** seeding runs
- **THEN** both files SHALL be byte-identical afterwards
- **AND** `.pi/dashboard/knowledge_base.json` SHALL be written

### Requirement: Seeded worktreeInit hook is valid or inert

The seeded `.pi/settings.json` SHALL carry a structurally valid `worktreeInit`
hook. When `detect-stack` identifies the project's stack, the hook SHALL carry
that stack's gate and install command. When no stack is detected, the hook
SHALL be rendered INERT — a gate that never exits 0 — rather than persisting an
unresolved template placeholder. The rendered `settings.json` SHALL contain no
`{{KEY}}` placeholder.

#### Scenario: Detected stack fills the hook

- **GIVEN** a directory containing `pnpm-lock.yaml`
- **WHEN** seeding runs
- **THEN** the hook's gate SHALL be `test ! -d node_modules`
- **AND** its command SHALL be `pnpm install --frozen-lockfile`

#### Scenario: Unknown stack yields an inert hook

- **GIVEN** a directory with no recognized stack marker
- **WHEN** seeding runs
- **THEN** the hook's gate SHALL be `false`
- **AND** the init-status probe SHALL report `needsInit: false` for it

## MODIFIED Requirements

### Requirement: Project-init performs a full scaffold

On confirmation, the skill SHALL write, from the chosen profile: `<dir>/AGENTS.md`, `<dir>/.pi/settings.json` (including a valid `worktreeInit` hook and the profile's toolset toggles), and the profile's prompt files. After writing, the directory SHALL report `hasHook: true` to the worktree-init-status endpoint, so a subsequent Initialize click runs the written hook. The DOX step SHALL append to `AGENTS.md` only a marker + pointer block (doctrine is injected by the kb extension; tuned via `.pi/dashboard/knowledge_base.json`), not the doctrine text. After scaffolding the directory `AGENTS.md` tree, the skill SHALL offer to run `dox-describe` to fill the empty Purpose cells.

The scaffold SHALL additionally support a GAP-FILL mode, used by unattended
seeding, in which only absent artifacts are written, an existing target is
recorded as skipped instead of raising a conflict error, and the DOX doctrine
block is appended only to an `AGENTS.md` the call created. The interactive
skill's all-or-nothing behaviour (preview conflicts, then overwrite on explicit
confirmation) SHALL be unchanged.

#### Scenario: Gap-fill mode writes only what is missing

- **GIVEN** a target directory where `AGENTS.md` already exists
- **WHEN** the scaffold runs in gap-fill mode
- **THEN** it SHALL NOT throw
- **AND** `AGENTS.md` SHALL appear in the result's `skipped` list
- **AND** the remaining profile artifacts SHALL be written
