## ADDED Requirements

### Requirement: Profile bundle shape

A project profile SHALL be a directory bundling: an `AGENTS.md.tmpl` (instructions template), a `settings.json.tmpl` (which SHALL contain a `worktreeInit` hook conforming to the worktree-init-hook schema plus toolset toggles), and a `prompts/` directory of separate, individually-editable prompt files.

#### Scenario: Profile carries required artifacts

- **WHEN** a profile directory `coding/` is loaded
- **THEN** it SHALL provide an `AGENTS.md` template, a `settings.json` template containing a `worktreeInit` hook, and zero or more prompt files under `prompts/`

#### Scenario: Profile hook conforms to schema

- **WHEN** a profile's `settings.json.tmpl` is rendered
- **THEN** its `worktreeInit` SHALL be a valid hook (a `gate` plus a `script` or `agent` `run`)

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
