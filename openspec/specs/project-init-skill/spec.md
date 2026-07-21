# project-init-skill Specification

## Purpose
TBD - created by archiving change project-init-skill-and-profiles. Update Purpose after archive.
## Requirements
### Requirement: Project-init skill is interactive and profile-driven

The pi-dashboard SHALL deliver a `project-init` skill that scaffolds an unconfigured directory into a configured pi project. The skill SHALL run as a first-class, interactive dashboard session (visible transcript, abortable) — NOT a detached process. It SHALL enumerate resolved profiles, ask the user to select one, preview the planned writes, and proceed only on confirmation.

#### Scenario: Skill lists profiles and asks for a choice

- **WHEN** the project-init skill runs in a directory
- **THEN** it SHALL present the resolved profiles (shipped ∪ user)
- **AND** SHALL ask the user which profile to use

#### Scenario: Skill confirms before writing

- **WHEN** a profile is selected
- **THEN** the skill SHALL preview the files it will write
- **AND** SHALL write them only after the user confirms

### Requirement: Project-init performs a full scaffold

On confirmation, the skill SHALL write, from the chosen profile: `<dir>/AGENTS.md`, `<dir>/.pi/settings.json` (including a valid `worktreeInit` hook and the profile's toolset toggles), and the profile's prompt files. After writing, the directory SHALL report `hasHook: true` to the worktree-init-status endpoint, so a subsequent Initialize click runs the written hook.

#### Scenario: Scaffold writes AGENTS.md, settings, and prompts

- **WHEN** the user confirms profile `coding`
- **THEN** the skill SHALL write `AGENTS.md`, `.pi/settings.json` (with a `worktreeInit` hook + toolset), and the profile's prompt files

#### Scenario: Scaffold flips the directory to configured

- **WHEN** the scaffold completes
- **THEN** the directory's `worktreeInit` hook SHALL be present
- **AND** worktree-init-status SHALL report `hasHook: true`

#### Scenario: Existing files are not clobbered silently

- **WHEN** the target directory already contains `AGENTS.md` or `.pi/settings.json`
- **THEN** the skill SHALL ask before overwriting

### Requirement: Project-init MAY initialize OpenSpec for coding profiles

When the selected profile is `coding` (an OpenSpec-enabled profile), the skill SHALL offer an opt-in to initialize OpenSpec by running `openspec init --tools pi`. The offer SHALL be a separate `ask_user` (confirm) and SHALL be skipped entirely when an `openspec/` directory already exists in the target (idempotent). The command SHALL be run non-interactively (always passing `--tools pi`) so it never hijacks the session's conversation. A non-zero exit (or a missing `openspec` binary) SHALL warn the user without failing the scaffold. Non-coding / OpenSpec-off profiles SHALL NOT offer this step.

#### Scenario: Coding profile offers OpenSpec init

- **GIVEN** the user selected the `coding` profile and no `openspec/` directory exists
- **WHEN** the skill runs
- **THEN** it SHALL ask whether to run `openspec init --tools pi`
- **AND** on confirmation SHALL run it non-interactively and verify success

#### Scenario: OpenSpec init skipped when already initialized

- **WHEN** an `openspec/` directory already exists in the target
- **THEN** the skill SHALL NOT prompt for or run OpenSpec init

#### Scenario: Non-coding profile never offers OpenSpec init

- **WHEN** a `docs` (or any OpenSpec-off) profile is selected
- **THEN** the skill SHALL NOT offer to run `openspec init`

