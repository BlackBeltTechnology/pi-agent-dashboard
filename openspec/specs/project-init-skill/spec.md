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

