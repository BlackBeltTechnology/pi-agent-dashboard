# project-profiles Specification

## Purpose
TBD - created by archiving change project-init-skill-and-profiles. Update Purpose after archive.
## Requirements
### Requirement: Profile bundle shape

A project profile SHALL be a directory bundling: an `AGENTS.md.tmpl` (instructions template), a `settings.json.tmpl` (which SHALL contain a `worktreeInit` hook conforming to the worktree-init-hook schema plus toolset toggles), a `prompts/` directory of separate, individually-editable prompt files, and an optional `dox` opt-in flag (default off).

#### Scenario: Profile carries required artifacts

- **WHEN** a profile directory `coding/` is loaded
- **THEN** it SHALL provide an `AGENTS.md` template, a `settings.json` template containing a `worktreeInit` hook, and zero or more prompt files under `prompts/`

#### Scenario: Profile hook conforms to schema

- **WHEN** a profile's `settings.json.tmpl` is rendered
- **THEN** its `worktreeInit` SHALL be a valid hook (a `gate` plus a `script` or `agent` `run`)

### Requirement: DOX is an interactive opt-in defaulted by the profile flag

A profile MAY declare an optional `dox` flag (default off). The flag SHALL NOT directly gate seeding; instead the skill SHALL offer DOX as an interactive `ask_user` (confirm) on EVERY profile, pre-selecting the profile's `dox` value as the DEFAULT answer. The user's answer (`DOX_ENABLED`) SHALL decide whether the doctrine is seeded. The DOX doctrine SHALL be a single canonical artifact shipped once with the project-init skill (not embedded per profile) and SHALL live under a kb-indexed path so it is retrievable by search. When the user enables DOX, the skill SHALL seed the doctrine into the target root `AGENTS.md` only when that file does not already carry it, detected by a stable marker; when the marker is present the seed SHALL be a no-op. On a DOX-enabled scaffold the rendered `.pi/dashboard/knowledge_base.json` (the kb config) SHALL enable the directory-level AGENTS.md toolset (`indexAgentsFiles`, `directoryLevelAgents`); `settings.json` carries only the `worktreeInit` hook.

The seeded doctrine SHALL cover both a WRITE discipline (maintaining the per-directory `AGENTS.md` tree) and a READ discipline (finding docs). The WRITE discipline SHALL include a **size rule**: because pi auto-injects a directory `AGENTS.md` on every turn when cwd sits at/below it, an over-large directory `AGENTS.md` (past a byte cap — typically a flat directory holding many files) is not supported and SHALL be split **file-based** — rows exceeding a length threshold promote to a per-file `<File>.AGENTS.md` sidecar carrying that file's full detail (including every `See change:`), pull-only because its name is not `AGENTS.md` (no auto-inject) yet still search-indexed (`agents` doc_type); the directory `AGENTS.md` retains a one-line summary plus a `→ see \`<File>.AGENTS.md\`` pointer, and rows within the threshold stay verbatim. The READ discipline wording SHALL be conditional on the kb toolset: when the profile wires the kb toolset, the doctrine SHALL instruct retrieval via `kb agents <path>` (nearest-chain walk) and `kb_search` (full-text) before grepping source; when the kb toolset is NOT wired, the doctrine SHALL use the manual chain-walk wording and SHALL NOT reference `kb_search` or `kb agents`.

#### Scenario: Profile flag sets the default DOX answer

- **WHEN** the skill asks whether to enable DOX
- **THEN** the confirm prompt SHALL pre-select the chosen profile's `dox` value as the default answer
- **AND** the user's answer, not the raw flag, SHALL decide whether the doctrine is seeded

#### Scenario: Doctrine seeded when AGENTS.md lacks it

- **GIVEN** the user enables DOX and a target `AGENTS.md` with no doctrine marker
- **WHEN** the profile is scaffolded
- **THEN** the canonical DOX doctrine SHALL be appended to `AGENTS.md` with its marker
- **AND** the written `.pi/dashboard/knowledge_base.json` SHALL set `indexAgentsFiles: true` and enable `directoryLevelAgents`

#### Scenario: Doctrine not re-seeded when already present

- **GIVEN** a target `AGENTS.md` that already carries the doctrine marker
- **WHEN** DOX is enabled during scaffold (or re-run)
- **THEN** the doctrine SHALL NOT be appended again (idempotent no-op)

#### Scenario: Seeded doctrine includes kb retrieval instruction when kb toolset is wired

- **GIVEN** a DOX-enabled scaffold whose rendered `.pi/dashboard/knowledge_base.json` enables `indexAgentsFiles` + `directoryLevelAgents`
- **WHEN** the doctrine is seeded
- **THEN** the doctrine SHALL include a read-side instruction to use `kb agents <path>` and `kb_search` before grepping source

#### Scenario: Seeded doctrine omits kb wording when kb toolset absent

- **GIVEN** a DOX-opted scaffold where the kb toolset is not wired
- **WHEN** the doctrine is seeded
- **THEN** the doctrine SHALL use the manual chain-walk wording
- **AND** SHALL NOT reference `kb_search` or `kb agents`

#### Scenario: Seeded doctrine carries the large-AGENTS.md split rule

- **GIVEN** a DOX-enabled scaffold
- **WHEN** the doctrine is seeded
- **THEN** the WRITE discipline SHALL instruct splitting an over-large directory `AGENTS.md` file-based into per-file `<File>.AGENTS.md` sidecars (full detail, pull-only, still search-indexed) with capped one-line summary + pointer rows left in the directory `AGENTS.md`

#### Scenario: Declined DOX leaves AGENTS.md doctrine-free

- **WHEN** the user declines DOX during scaffold
- **THEN** no DOX doctrine SHALL be seeded and the directory-level AGENTS.md toolset SHALL NOT be force-enabled

### Requirement: Profile resolution merges shipped and user profiles

Profiles SHALL be resolved from two sources in order: (1) the shipped profiles under the project-init skill directory, then (2) `~/.pi/project-profiles/`. On a name collision, the user profile SHALL fully override the shipped profile of the same name. Project-local (`./.pi/`) profiles SHALL NOT be a resolution source.

#### Scenario: Shipped profiles available by default

- **WHEN** no user profiles exist
- **THEN** the resolver SHALL return the shipped profiles (including `coding` and `docs`)

#### Scenario: User profile overrides shipped by name

- **WHEN** `~/.pi/project-profiles/coding/` exists
- **THEN** the resolver SHALL return the user's `coding` profile in place of the shipped `coding`

#### Scenario: User profiles add to the set

- **WHEN** `~/.pi/project-profiles/research/` exists and no shipped `research` profile exists
- **THEN** the resolver SHALL include `research` alongside the shipped profiles

