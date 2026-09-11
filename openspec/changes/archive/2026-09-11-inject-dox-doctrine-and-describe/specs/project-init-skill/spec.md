## MODIFIED Requirements

### Requirement: Project-init performs a full scaffold

On confirmation, the skill SHALL write, from the chosen profile: `<dir>/AGENTS.md`, `<dir>/.pi/settings.json` (including a valid `worktreeInit` hook and the profile's toolset toggles), and the profile's prompt files. After writing, the directory SHALL report `hasHook: true` to the worktree-init-status endpoint, so a subsequent Initialize click runs the written hook. The DOX step SHALL append to `AGENTS.md` only a marker + pointer block (doctrine is injected by the kb extension; tuned via `.pi/dashboard/knowledge_base.json`), not the doctrine text. After scaffolding the directory `AGENTS.md` tree, the skill SHALL offer to run `dox-describe` to fill the empty Purpose cells.

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

#### Scenario: DOX step seeds a pointer, not the doctrine

- **WHEN** the DOX step runs
- **THEN** `AGENTS.md` gains the `<!-- dox-doctrine -->` marker and a pointer block
- **AND** it does not gain the doctrine section text

#### Scenario: Describe offered after tree scaffold

- **WHEN** the directory `AGENTS.md` tree has been scaffolded
- **THEN** the skill asks whether to run `dox-describe` now
